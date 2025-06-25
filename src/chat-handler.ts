import { Context } from 'grammy';
import {addChatMessage, ChatMessageType, getLastChatMessages, markMessagesAsAnswered} from './ydb';
import {getYandexGPTResponse} from "./gpt";

export async function chatHandler(ctx: Context, type: ChatMessageType) {
	const chatId = ctx.chat?.id || 0;
	const userId = ctx.from?.id || 0;
	const messageId = ctx.message?.message_id?.toString() || '0';
	const text = ctx.message?.text || '';

	await addChatMessage(chatId, messageId, userId, text, type, false);
}

export async function handleBatchMessages(
	chatId: number,
	userId: number,
	messageIds: string[]
) {
	try {
		const historyMessages = await getLastChatMessages(chatId, userId, 20);
		const gptMessages = historyMessages.map((v: any) => ({
			role: (v.type === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
			text: v.message
		}));

		const gptResponse = await getYandexGPTResponse(gptMessages, 'base', userId.toString());
		if (gptResponse?.text) {
			const { bot } = await import('./bot-instance');
			const { imitateTypingBatch } = await import('./telegram-utils');
			const textToReply = gptResponse.text;
			const delay = textToReply.length * 200;
			await imitateTypingBatch(bot, chatId, 0, delay);
			await bot.api.sendMessage(chatId, `${gptResponse.text}\nИспользовано: ${(parseInt(gptResponse?.totalUsage || '0') / 50).toFixed(2)} коп.`);

			await addChatMessage(
				chatId,
				`bot_${Date.now()}`,
				userId,
				gptResponse.text,
				'bot',
				true
			);

			await markMessagesAsAnswered(chatId, userId, messageIds);
		}
	} catch (error) {
		console.error('Batch processing error:', error);
		}
}