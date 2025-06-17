import * as fs from 'fs';
import * as path from 'path';

// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID; // Оставляем, если используется для x-folder-id или если modelUri в json не полный

// Глобальная переменная для хранения IAM токена из контекста
// Эта переменная будет устанавливаться из index.ts
let currentIamToken: string | null = null;

export function setIamToken(token: string | null) {
    currentIamToken = token;
}

interface GptConfig {
    model: string;
    completionOptions: {
        stream: boolean;
        temperature: number;
        maxTokens: number;
    };
    // systemPrompt: string; // Remove this line
}

interface UserDataItem {
    name: string;
    value: string;
}

let gptConfig: GptConfig | null = null;
let systemPromptContent: string | null = null; // Cache for the markdown content

function loadSystemPrompt(): string {
    if (systemPromptContent) {
        return systemPromptContent;
    }
    try {
        const promptPath = path.resolve(__dirname, 'system_prompt.md');
        systemPromptContent = fs.readFileSync(promptPath, 'utf-8');
        return systemPromptContent;
    } catch (error) {
        console.error('Failed to load system_prompt.md:', error);
        // Fallback prompt or re-throw error
        return "Системный промпт по умолчанию, если system_prompt.md не найден. {{Имя риелтора}} {{Опыт}}"; 
    }
}

function loadGptConfig(): GptConfig {
    if (gptConfig) {
        return gptConfig;
    }
    try {
        const configPath = path.resolve(__dirname, 'gpt.json');
        const configFile = fs.readFileSync(configPath, 'utf-8');
        const parsedConfig = JSON.parse(configFile) as Omit<GptConfig, 'systemPrompt'>; // Parse without systemPrompt
        
        gptConfig = parsedConfig as GptConfig; // Cast to GptConfig after potential modifications
        return gptConfig;
    } catch (error) {
        console.error('Failed to load gpt.json:', error);
        return {
            model: "/yandexgpt-lite/latest",
            completionOptions: {
                stream: false,
                temperature: 0.6,
                maxTokens: 20000
            },
        } as GptConfig; // Cast to GptConfig
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

        const config = loadGptConfig();
        const baseSystemPrompt = loadSystemPrompt(); // Load from .md file
        const systemPrompt = formatSystemPrompt(baseSystemPrompt, [...userData, { name: 'profile', value: userData.map(i=>`- ${i.value}: ${i.value}`).join('\n') }]);
        console.log('Using IAM token type:', typeof currentIamToken);
        console.log('IAM token length:', currentIamToken.length);
        console.log('IAM token starts with:', currentIamToken.substring(0, 10));
        console.log('Using folder ID:', FOLDER_ID);

        const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

        const requestBody = {
            modelUri: `gpt://${FOLDER_ID}${config.model}`, // Используем из конфига
            completionOptions: config.completionOptions, // Используем из конфига
            messages: [
                {
                    role: 'system',
                    text: systemPrompt // Используем отформатированный systemPrompt
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