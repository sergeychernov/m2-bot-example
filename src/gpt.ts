import * as fs from 'fs';
import * as path from 'path';

// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID; // Оставляем, если используется для x-folder-id или если modelUri в json не полный
// const YANDEX_GPT_MODEL_LITE_URI = `gpt://${FOLDER_ID}/yandexgpt-lite/latest`; // Удаляем или комментируем

// Глобальная переменная для хранения IAM токена из контекста
// Эта переменная будет устанавливаться из index.ts
let currentIamToken: string | null = null;

export function setIamToken(token: string | null) {
    currentIamToken = token;
}

interface GptConfig {
    modelUri: string;
    completionOptions: {
        stream: boolean;
        temperature: number;
        maxTokens: number;
    };
    systemPrompt: string;
}

let gptConfig: GptConfig | null = null;

function loadGptConfig(): GptConfig {
    if (gptConfig) {
        return gptConfig;
    }
    try {
        const configPath = path.resolve(__dirname, 'gpt.json');
        const configFile = fs.readFileSync(configPath, 'utf-8');
        gptConfig = JSON.parse(configFile) as GptConfig;
        // Если FOLDER_ID все еще нужен для modelUri из gpt.json (если там плейсхолдер)
        if (FOLDER_ID && gptConfig.modelUri.includes('YOUR_FOLDER_ID')) {
             gptConfig.modelUri = gptConfig.modelUri.replace('YOUR_FOLDER_ID', FOLDER_ID);
        }
        return gptConfig;
    } catch (error) {
        console.error('Failed to load gpt.json:', error);
        // Возвращаем конфигурацию по умолчанию или выбрасываем ошибку, если файл критичен
        // Для примера, вернем конфигурацию по умолчанию, схожую с вашей предыдущей
        return {
            modelUri: `gpt://${FOLDER_ID || 'default_folder_id'}/yandexgpt-lite/latest`,
            completionOptions: {
                stream: false,
                temperature: 0.6,
                maxTokens: 20000
            },
            systemPrompt: "Системный промпт по умолчанию, если gpt.json не найден."
        };
    }
}

// Обновленная функция getYandexGPTResponse
export async function getYandexGPTResponse(userMessages: {
    role: 'user'|'assistant'; // Убираем 'system', так как он будет из gpt.json
    text: string;
}[]): Promise<{ text: string; totalUsage?: string } | null> {
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

        console.log('Using IAM token type:', typeof currentIamToken);
        console.log('IAM token length:', currentIamToken.length);
        console.log('IAM token starts with:', currentIamToken.substring(0, 10));
        console.log('Using folder ID:', FOLDER_ID);

        const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

        const requestBody = {
            modelUri: config.modelUri, // Используем из конфига
            completionOptions: config.completionOptions, // Используем из конфига
            messages: [
                {
                    role: 'system',
                    text: config.systemPrompt // Используем из конфига
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