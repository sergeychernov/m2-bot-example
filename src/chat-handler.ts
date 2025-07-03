import { Context } from 'grammy';
import {addChatMessage, ChatMessageType, getLastChatMessages, markMessagesAsAnswered} from './ydb';
import {getYandexGPTResponse} from "./gpt";

export async function chatHandler(ctx: Context, type: ChatMessageType) {
	const chatId = ctx.chat?.id || 0;
	const businessConnectionId = ctx.businessConnectionId || '';
	const messageId = ctx.message?.message_id || 0;
	const repliedText = ctx.message?.reply_to_message?.text || '';
	const text = ctx.message?.text || '';

	await addChatMessage(chatId, messageId, businessConnectionId, text, type, repliedText);
}

export async function handleBatchMessages(
	chatId: number,
	businessConnectionId: string,
	messageIds: number[]
) {
	try {
		const historyMessages = await getLastChatMessages(chatId, businessConnectionId, 30);
		const gptMessages = historyMessages.map((v: any) => {
			if (v.replied_message) {
				return {
					role: (v.type === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
					text: `Пользователь ответил на сообщение "${v.message}": ${v.replied_message}`
				}
			}
			return {
				role: (v.type === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
				text: v.message
			}
		});

		const gptResponse = await getYandexGPTResponse(gptMessages, 'base', businessConnectionId, chatId);
		if (gptResponse?.text) {
			const { bot } = await import('./bot-instance');
			const { imitateTypingBatch } = await import('./telegram-utils');
			const textToReply = gptResponse.text;
			const delay = textToReply.length * 200;
			await imitateTypingBatch(bot, chatId, 0, delay, businessConnectionId);

			try {
				// Пытаемся отправить сообщение через business connection если он указан
				const sentMessage = businessConnectionId
					? await bot.api.sendMessage(chatId, gptResponse.text, { business_connection_id: businessConnectionId })
					: await bot.api.sendMessage(chatId, gptResponse.text);

				await addChatMessage(
					chatId,
					sentMessage.message_id,
					businessConnectionId,
					gptResponse.text,
					'bot'
				);

				await markMessagesAsAnswered(chatId, businessConnectionId, messageIds);

			} catch (e: any) {
				// если риелтор отключил бот после получения сообщения от клиента и ответ невозможно доставить
				if (e.description?.includes('BUSINESS_PEER_INVALID')) {
					await markMessagesAsAnswered(chatId, businessConnectionId, messageIds);
					console.warn('Ответ не доставлен из-за того, что пользователь отключил бот, BUSINESS_PEER_INVALID');
				} else {
					throw e;
				}
			}
		}
	} catch (error) {
		console.error('Ошибка при ответе на сообщение от клиента:', JSON.stringify(error));
	}
}