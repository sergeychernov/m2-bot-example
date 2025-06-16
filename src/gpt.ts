// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID;
const YANDEX_GPT_MODEL_LITE_URI = `gpt://${FOLDER_ID}/yandexgpt-lite/latest`;

// Глобальная переменная для хранения IAM токена из контекста
// Эта переменная будет устанавливаться из index.ts
let currentIamToken: string | null = null;

export function setIamToken(token: string | null) {
    currentIamToken = token;
}

// Обновленная функция getYandexGPTResponse
export async function getYandexGPTResponse(prompt: string|{
    role: 'user'|'assistant'|'system';
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

        console.log('Using IAM token type:', typeof currentIamToken);
        console.log('IAM token length:', currentIamToken.length);
        console.log('IAM token starts with:', currentIamToken.substring(0, 10));
        console.log('Using folder ID:', FOLDER_ID);

        const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

        const requestBody = {
            modelUri: YANDEX_GPT_MODEL_LITE_URI,
            completionOptions: {
                stream: false,
                temperature: 0.6,
                maxTokens: 20000
            },
            messages: typeof prompt === 'string' ? [
                {
                    role: 'user',
                    text: prompt
                }
            ] : prompt,
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