import * as fs from 'fs';
import * as path from 'path';
import { getLatestPromptByType, Prompt } from './ydb'; // Обновляем импорт Prompt

// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID; // Оставляем, если используется для x-folder-id или если modelUri в json не полный

// Глобальная переменная для хранения IAM токена из контекста
// Эта переменная будет устанавливаться из index.ts
let currentIamToken: string | null = null;

export function setIamToken(token: string | null) {
    currentIamToken = token;
}

interface UserDataItem {
    name: string;
    value: string;
}

// Переименовываем и изменяем функцию для загрузки всех настроек из БД
async function loadGptSettingsFromDb(iamToken?: string): Promise<Prompt | null> { 
    try {
        const latestPromptSettings = await getLatestPromptByType('base', iamToken);
        if (latestPromptSettings) {
            return latestPromptSettings;
        }
        console.warn('No base prompt settings found in DB, using fallback or defaults.');
        // Можно вернуть объект с настройками по умолчанию, если это необходимо
        return null; 
    } catch (error) {
        console.error('Failed to load GPT settings from DB:', JSON.stringify(error));
        return null;
    }
}

function formatSystemPrompt(basePrompt: string, userData: UserDataItem[]): string {
    let prompt = basePrompt;
    userData.forEach(item => {
        const placeholder = `{{${item.name}}}`;
        prompt = prompt.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), item.value);
    });
    return prompt;
}

// Обновленная функция getYandexGPTResponse
export async function getYandexGPTResponse(
    userMessages: {
        role: 'user' | 'assistant';
        text: string;
    }[],
    userData: UserDataItem[] // Добавляем userData
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

        const gptSettings = await loadGptSettingsFromDb(currentIamToken); // Загружаем настройки из БД

        if (!gptSettings) {
            console.error('Failed to load GPT settings from database.');
            return { text: 'Ошибка: Не удалось загрузить настройки GPT из базы данных.' };
        }

        const systemPromptText = formatSystemPrompt(gptSettings.promptText, [...userData, { name: 'profile', value: userData.map(i=>`- ${i.name}: ${i.value}`).join('\n') }]);

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