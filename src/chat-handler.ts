import { Context } from 'grammy';
import {addChatMessage, ChatMessageType, getLastChatMessages, markMessagesAsAnswered} from './ydb';
import {getYandexGPTResponse} from "./gpt";

export async function chatHandler(ctx: Context, type: ChatMessageType) {
	const chatId = ctx.chat?.id || 0;
	const businessConnectionId = ctx.businessConnectionId || '';
	const messageId = ctx.message?.message_id || 0;
	const text = ctx.message?.text || '';

	await addChatMessage(chatId, messageId, businessConnectionId, text, type);
}

export async function handleBatchMessages(
	chatId: number,
	businessConnectionId: string,
	messageIds: number[]
) {
	try {
		const historyMessages = await getLastChatMessages(chatId, businessConnectionId, 30);
		const gptMessages = historyMessages.map((v: any) => ({
			role: (v.type === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
			text: v.message
		}));

		const gptResponse = await getYandexGPTResponse(gptMessages, 'base', businessConnectionId);
		if (gptResponse?.text) {
			const { bot } = await import('./bot-instance');
			const { imitateTypingBatch } = await import('./telegram-utils');
			const textToReply = gptResponse.text;
			const delay = textToReply.length * 200;
			await imitateTypingBatch(bot, chatId, 0, delay);
			const sentMessage = await bot.api.sendMessage(chatId, gptResponse.text);

			await addChatMessage(
				chatId,
				sentMessage.message_id,
				businessConnectionId,
				gptResponse.text,
				'bot'
			);

			await markMessagesAsAnswered(chatId, businessConnectionId, messageIds);
		}
	} catch (error) {
		console.error('Batch processing error:', error);
		}
}