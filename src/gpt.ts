import {
    getLatestPromptByType,
    Prompt,
    getDriver,
    logger
} from './ydb';
import {
  Types
} from 'ydb-sdk';
import { formatProfileMarkdownV2 } from "./telegram-utils";
import { getUserDataByBusinessConnectionId } from './users';

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

    const profileData = formatProfileMarkdownV2(userData);
    prompt = prompt.replace(/{{profile}}/g, profileData);

    return prompt;
}

// Обновленная функция getYandexGPTResponse
// Функция для логирования бюджета
async function logBudget(
    chatId: number,
    businessConnectionId: string,
    inputTextTokens: number,
    completionTokens: number,
    totalTokens: number,
    alternatives: number,
    messages: number,
    promptType: string,
    iamToken?: string
): Promise<void> {
    const currentDriver = await getDriver(iamToken);
    const tableName = 'budget';

    const query = `
        PRAGMA TablePathPrefix("${process.env.YDB_DATABASE}");
        DECLARE $chatId AS Int64;
        DECLARE $business_connection_id AS Utf8;
        DECLARE $inputTextTokens AS Int64;
        DECLARE $completionTokens AS Int64;
        DECLARE $totalTokens AS Int64;
        DECLARE $alternatives AS Int64;
        DECLARE $messages AS Int64;
        DECLARE $promptType AS Utf8;
        DECLARE $timestamp AS Timestamp;

        INSERT INTO ${tableName} (chatId, business_connection_id, inputTextTokens, completionTokens, totalTokens, alternatives, messages, promptType, timestamp)
        VALUES ($chatId, $business_connection_id, $inputTextTokens, $completionTokens, $totalTokens, $alternatives, $messages, $promptType, $timestamp);
    `;

    try {
        await currentDriver.tableClient.withSession(async (session) => {
            const preparedQuery = await session.prepareQuery(query);
            await session.executeQuery(preparedQuery, {
                '$chatId': { type: Types.INT64, value: { int64Value: chatId } },
                '$business_connection_id': { type: Types.UTF8, value: { textValue: businessConnectionId } },
                '$inputTextTokens': { type: Types.INT64, value: { int64Value: inputTextTokens } },
                '$completionTokens': { type: Types.INT64, value: { int64Value: completionTokens } },
                '$totalTokens': { type: Types.INT64, value: { int64Value: totalTokens } },
                '$alternatives': { type: Types.INT64, value: { int64Value: alternatives } },
                '$messages': { type: Types.INT64, value: { int64Value: messages } },
                '$promptType': { type: Types.UTF8, value: { textValue: promptType } },
                '$timestamp': { type: Types.TIMESTAMP, value: { uint64Value: Date.now() * 1000 } },
            });
        });
        logger.info(`Successfully logged budget for chatId: ${chatId}, businessConnectionId: ${businessConnectionId}`);
    } catch (error) {
        logger.error(`Error logging budget for chatId: ${chatId}, businessConnectionId: ${businessConnectionId}`, JSON.stringify(error));
        throw error;
    }
}

export async function getYandexGPTResponse(
    userMessages: {
        role: 'user' | 'assistant';
        text: string;
    }[],
    promptType: string,
    businessConnectionId: string,
    chatId: number,
): Promise<{ text: string; totalUsage?: string; error?: boolean } | null> {
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

        const userData = await getUserDataByBusinessConnectionId(businessConnectionId);
        if (!userData) {
            console.warn(`No user data found for userId: ${businessConnectionId}. Proceeding without it.`);
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
            return { text: `Ошибка API: ${response.status} - ${errorText}`, totalUsage: undefined, error: true };
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
            // Логируем бюджет при успешном ответе
            try {
                await logBudget(
                    chatId,
                    businessConnectionId,
                    parseInt(result.result.usage.inputTextTokens),
                    parseInt(result.result.usage.completionTokens),
                    parseInt(result.result.usage.totalTokens),
                    result.result.alternatives.length, // длина массива alternatives
                    userMessages.length, // длина userMessages
                    promptType,
                    currentIamToken
                );
            } catch (budgetError) {
                logger.error('Failed to log budget:', JSON.stringify(budgetError));
                // Не прерываем выполнение, если логирование бюджета не удалось
            }
            
            return { text: result.result.alternatives[0].message.text, totalUsage: result.result?.usage.totalTokens };
        } else {
            console.error('Unexpected response format:', result);
            return { text: 'Ошибка: Неожиданный формат ответа от YandexGPT', totalUsage: undefined };
        }

    } catch (error: any) {
        console.error('Error getting Yandex GPT response:', JSON.stringify(error));
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { text: `Ошибка: ${errorMessage} ${businessConnectionId}`, totalUsage: undefined };
    }
}