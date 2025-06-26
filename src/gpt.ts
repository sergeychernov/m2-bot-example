import {
    getLatestPromptByType,
    Prompt,
    getBotClientData,
} from './ydb';

// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID; // Оставляем, если используется для x-folder-id или если modelUri в json не полный

// Глобальная переменная для хранения IAM токена из контекста
// Эта переменная будет устанавливаться из index.ts
let currentIamToken: string | null = null;

export function setIamToken(token: string | null) {
    currentIamToken = token;
}

// Расширяемый словарь для хранения любых пользовательских данных
export interface UserDataItem {
  [key: string]: any;
}

// Переименовываем и изменяем функцию для загрузки всех настроек из БД
async function loadGptSettingsFromDb(promptType: string, iamToken?: string): Promise<Prompt | null> { 
    try {
        const latestPromptSettings = await getLatestPromptByType(promptType, iamToken);
        if (latestPromptSettings) {
            return latestPromptSettings;
        }
        console.warn(`No ${promptType} prompt settings found in DB, using fallback or defaults.`);
        // Можно вернуть объект с настройками по умолчанию, если это необходимо
        return null; 
    } catch (error) {
        console.error('Failed to load GPT settings from DB:', JSON.stringify(error));
        return null;
    }
}

export function formatSystemPrompt(basePrompt: string, userData: Record<string, any>): string {
    let prompt = basePrompt;
    for (const key in userData) {
        prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), userData[key]);
    }

    const profileData = Object.entries(userData)
        .map(([key, value]) => {
            if (Array.isArray(value)) {
                return `- ${key}: ${value.join(', ')}`;
            } else {
                return `- ${key}: ${value}`;
            }
        })
        .join('\n');
    prompt = prompt.replace(/{{profile}}/g, profileData);

    return prompt;
}

// Обновленная функция getYandexGPTResponse
export async function getYandexGPTResponse(
    userMessages: {
        role: 'user' | 'assistant';
        text: string;
    }[],
    promptType: string,
    userId: number
): Promise<{ text: string; totalUsage?: string } | null> {
    try {
        if (!currentIamToken) {
            console.error('IAM token not available');
            return { text: 'Ошибка: IAM токен недоступен' };
        }

        if (!FOLDER_ID) {
            console.error('Yandex Folder ID is not configured.');
            return { text: 'Ошибка конфигурации: Yandex Folder ID не настроен.' };
        }

        const gptSettings = await loadGptSettingsFromDb(promptType, currentIamToken);

        if (!gptSettings) {
            console.error('Failed to load GPT settings from database.');
            return { text: 'Ошибка: Не удалось загрузить настройки GPT из базы данных.' };
        }

        const userData = await getBotClientData(userId);
        if (!userData) {
            console.warn(`No user data found for userId: ${userId}. Proceeding without it.`);
        }

        const systemPromptText = formatSystemPrompt(gptSettings.promptText, userData?.profile || {});

        const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

        const requestBody = {
            modelUri: `gpt://${FOLDER_ID}${gptSettings.model}`, // Используем model из gptSettings
            completionOptions: { // Используем completionOptions из gptSettings
                stream: gptSettings.stream,
                temperature: gptSettings.temperature,
                maxTokens: gptSettings.maxTokens,
            },
            messages: [
                {
                    role: 'system',
                    text: systemPromptText 
                },
                ...userMessages // Добавляем сообщения пользователя и ассистента
            ],
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentIamToken}`,
                'x-folder-id': FOLDER_ID
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('YandexGPT API error:', response.status, errorText);
            return { text: `Ошибка API: ${response.status} - ${errorText}`, totalUsage: undefined };
        }

        interface YandexGPTResponse {
            result: {
                alternatives: Array<{
                    message: {
                        text: string;
                    };
                }>;
                usage: {
                  inputTextTokens: string;
                  completionTokens: string;
                  totalTokens: string;
              };
            };
        }

        const result = await response.json() as YandexGPTResponse;

        if (result.result && result.result.alternatives && result.result.alternatives.length > 0) {
            return { text: result.result.alternatives[0].message.text, totalUsage: result.result?.usage.totalTokens };
        } else {
            console.error('Unexpected response format:', result);
            return { text: 'Ошибка: Неожиданный формат ответа от YandexGPT', totalUsage: undefined };
        }

    } catch (error: any) {
        console.error('Error getting Yandex GPT response:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { text: `Ошибка: ${errorMessage}`, totalUsage: undefined };
    }
}