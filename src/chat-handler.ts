import { Context } from 'grammy';
import {addChatMessage, ChatMessageType, getLastChatMessages, markMessagesAsAnswered, getUnansweredMessages} from './ydb';
import {getGPTResponse} from "./gpt";

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

		const gptResponse = await getGPTResponse(gptMessages, 'base', businessConnectionId, chatId);
		if (gptResponse?.text && !gptResponse.error) {
			const { bot } = await import('./bot-instance');
			const { imitateTypingBatch } = await import('./telegram-utils');
			const textToReply = gptResponse.text;
			const delay = textToReply.length * 200;
			await imitateTypingBatch(bot, chatId, 0, delay, businessConnectionId);

			const currentUnanswered = await getUnansweredMessages(chatId, businessConnectionId);
			const currentIds = currentUnanswered.map((m: any) => m.messageId);
			if (
				currentIds.length > messageIds.length ||
				!messageIds.every(id => currentIds.includes(id))
			) {
				console.log('Появились новые сообщения во время имитации тайпинга, обработка прервана');
				return;
			}

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
		} else {
			console.error('[handleBatchMessages] Ошибка от gpt, сообщения НЕ помечаем как отвеченные:', gptResponse?.text);
		}
	} catch (error) {
		console.error('Ошибка при ответе на сообщение от клиента:', JSON.stringify(error));
	}
}