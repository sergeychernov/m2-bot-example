import { Context } from 'grammy';
import { addChatMessage, getLastChatMessages, ChatMessageType } from './ydb';
import { getYandexGPTResponse } from './gpt';
import { imitateTyping } from './telegram-utils';

const FOLDER_ID = process.env.YC_FOLDER_ID;

export async function chatHandler(ctx: Context, type: ChatMessageType) {
	const userId = ctx.from?.id || 0;
	const chatId = ctx.chat?.id || 0;
    await addChatMessage(chatId, ctx.message?.message_id?.toString() || '0', userId, ctx.message?.text || '0', type);
    const promptText = ctx.message?.text; // Переименовал prompt в promptText для ясности
    if (promptText) {
        try {

            if (!FOLDER_ID) {
                console.error('Yandex Folder ID is not configured.');
                await ctx.reply('Ошибка конфигурации: Yandex Folder ID не настроен.');
                return;
            }

            const historyMessages = await getLastChatMessages(chatId, userId, 20);
            // Формируем только сообщения пользователя и ассистента для передачи в getYandexGPTResponse
            const gptMessages = historyMessages.map((v) => ({
                role: (v.type === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
                text: v.message
            }));
            
            if (!ctx.from) {
                console.error('Cannot get user ID from context');
                await ctx.reply('Ошибка: не удалось определить пользователя.');
                return;
            }

            const gptResponse = await getYandexGPTResponse(gptMessages, 'base', ctx.from.id.toString());
            
            if (gptResponse && gptResponse.text) {
            

            // Рассчитываем задержку
            const textToReply = gptResponse.text;
            const startDelay = promptText.length * 100 + 2000; // Changed from prompt.length
            const delay = textToReply.length * 200; // 300 мс на символ
            await imitateTyping(ctx, startDelay, delay);

            const r = await ctx.reply(textToReply + `\nИспользовано: ${(parseInt((gptResponse?.totalUsage || '0').toString()) / 50).toFixed(2)} коп`);
            
            await addChatMessage(chatId, r.message_id.toString() || '0', userId, textToReply, 'bot');
                
          } else {
                await ctx.reply('Не удалось получить ответ от YandexGPT.');
            }
        } catch (error) {
            console.error('Error processing Yandex GPT request:', JSON.stringify(error));
            await ctx.reply('Произошла ошибка при обработке вашего запроса к YandexGPT.');
        }
    } else {
        await ctx.reply('Пожалуйста, укажите ваш запрос после "y:". Например: y: расскажи анекдот');
    }
}