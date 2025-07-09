import {
    getLatestPromptByType,
    Prompt,
    getDriver,
    logger,
    getMode
} from './ydb';
import {
  Types
} from 'ydb-sdk';
import { formatProfileMarkdownV2 } from "./telegram-utils";
import { getUserDataByBusinessConnectionId, getUserDataByUserId } from './users';
import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';

// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID; // Оставляем, если используется для x-folder-id или если modelUri в json не полный
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SOCKS5H = process.env.SOCKS5H || '';

const agent = new SocksProxyAgent(SOCKS5H);

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

// Note: The 'Content' type is no longer needed from '@google/genai'
// We will define a similar structure for the REST API call.

interface GeminiPart {
    text: string;
}

interface GeminiContent {
    role: 'user' | 'model';
    parts: GeminiPart[];
}

interface GeminiErrorResponse {
    error?: {
        message?: string;
    };
}

interface GeminiSuccessResponse {
    candidates?: {
        content?: {
            parts?: {
                text?: string;
            }[];
        };
    }[];
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

async function getGeminiResponse(
    userMessages: { role: 'user' | 'assistant'; text: string }[],
    systemPromptText: string,
    gptSettings: Prompt
): Promise<GPTResponse> {
    if (!GEMINI_API_KEY) {
        console.error('Gemini API key is not configured.');
        return { text: 'Ошибка конфигурации: Gemini API ключ не настроен.', error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${gptSettings.model}:generateContent?key=${GEMINI_API_KEY}`;

    const contents: GeminiContent[] = [];
    for (const msg of userMessages) {
        const role = msg.role === 'user' ? 'user' : 'model';
        const lastContent = contents.length > 0 ? contents[contents.length - 1] : null;

        if (lastContent && lastContent.role === role) {
            lastContent.parts.push({ text: msg.text });
        } else {
            contents.push({ role, parts: [{ text: msg.text }] });
        }
    }

    const body = {
        contents: contents,
        systemInstruction: {
            parts: [
                {
                    text: systemPromptText
                }
            ]
        },
        generationConfig: {
            temperature: gptSettings.temperature,
            maxOutputTokens: gptSettings.maxTokens,
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            agent,
        });
        console.log('getGeminiResponse.body', JSON.stringify(body));

        if (!response.ok) {
            const errorData = await response.json() as GeminiErrorResponse;
            const errorMessage = errorData.error?.message || response.statusText;
            console.error('Error getting Gemini response:', JSON.stringify(errorData));
            return { text: `Ошибка Gemini: ${errorMessage}`, error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
        }

        const data = await response.json() as GeminiSuccessResponse;

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const promptTokenCount = data.usageMetadata?.promptTokenCount || 0;
        const candidatesTokenCount = data.usageMetadata?.candidatesTokenCount || 0;
        const totalTokenCount = data.usageMetadata?.totalTokenCount || 0;

        return { text, inputTextTokens: promptTokenCount, completionTokens: candidatesTokenCount, totalTokens: totalTokenCount };

    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error getting Gemini response:', JSON.stringify(error), errorMessage);
        return { text: `Ошибка Gemini: ${errorMessage}`, error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
}

async function getYandexGPTResponse(
    userMessages: { role: 'user' | 'assistant'; text: string }[],
    systemPromptText: string,
    gptSettings: Prompt
): Promise<GPTResponse> {
    if (!currentIamToken) {
        console.error('IAM token not available');
        return { text: 'Ошибка: IAM токен недоступен', error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }

    if (!FOLDER_ID) {
        console.error('Yandex Folder ID is not configured.');
        return { text: 'Ошибка конфигурации: Yandex Folder ID не настроен.', error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }

    const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

    const requestBody = {
        modelUri: `gpt://${FOLDER_ID}${gptSettings.model}`,
        completionOptions: {
            stream: gptSettings.stream,
            temperature: gptSettings.temperature,
            maxTokens: gptSettings.maxTokens,
        },
        messages: [
            {
                role: 'system',
                text: systemPromptText
            },
            ...userMessages
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
        return { text: `Ошибка API: ${response.status} - ${errorText}`, error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
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

        return { text: result.result.alternatives[0].message.text, inputTextTokens: parseInt(result.result.usage.inputTextTokens), completionTokens: parseInt(result.result.usage.completionTokens), totalTokens: parseInt(result.result.usage.totalTokens) };
    } else {
        console.error('Unexpected response format:', result);
        return { text: 'Ошибка: Неожиданный формат ответа от YandexGPT', error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
}

type GPTResponse = {
    text: string;
    inputTextTokens: number;
    completionTokens: number;
    totalTokens: number;
    error?: boolean;

}
export type UserMessage = {
        role: 'user' | 'assistant';
        text: string;
    }
export async function getGPTResponse(
    userMessages: UserMessage[],
    promptType: string,
    businessConnectionId: string,
    chatId: number,
    mode?: string,
): Promise<GPTResponse> {
    if (!currentIamToken) {
        console.error('IAM token not available');
        return { text: 'Ошибка: IAM токен недоступен', error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
    try {
        const gptSettings = await loadGptSettingsFromDb(promptType, currentIamToken);

        if (!gptSettings) {
            console.error('Failed to load GPT settings from database.');
            return { text: 'Ошибка: Не удалось загрузить настройки GPT из базы данных.', error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0  };
        }

        let userData = null;
        if (businessConnectionId) {
            userData = await getUserDataByBusinessConnectionId(businessConnectionId);
        }
        if (!userData && mode === 'demo' && chatId) {
            userData = await getUserDataByUserId(chatId);
        }
        if (!userData) {
            console.warn(`No user data found for businessConnectionId: ${businessConnectionId} or userId: ${chatId}. Proceeding without it.`);
        }

        const systemPromptText = formatSystemPrompt(gptSettings.promptText, userData?.profile || {});

        let response;
        if (gptSettings.model.startsWith('gemini')) {
            response = await getGeminiResponse(userMessages, systemPromptText, gptSettings);
        } else {
            response = await getYandexGPTResponse(userMessages, systemPromptText, gptSettings);
        }

        if (response && response.text && !response.error) {

                try {
                    // Assuming you can get token counts from somewhere for Yandex
                    // This part needs adjustment if you can't get the token counts before this call
                    await logBudget(
                        chatId,
                        businessConnectionId,
                        response.inputTextTokens,
                        response.completionTokens,
                        response.totalTokens,
                        1, // alternatives
                        userMessages.length, // messages
                        promptType,
                        currentIamToken
                    );
                } catch (budgetError) {
                    logger.error('Failed to log budget:', JSON.stringify(budgetError));
                }
            
            return response;
        } else {
            return response; // Return response with error
        }

    } catch (error: any) {
        console.error('Error getting GPT response:', JSON.stringify(error));
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { text: `Ошибка: ${errorMessage} ${businessConnectionId}`, error: true, inputTextTokens: 0, completionTokens: 0, totalTokens: 0 };
    }
}