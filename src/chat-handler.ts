import { Context } from 'grammy';
import {
	addChatMessage,
	getLastChatMessages,
	markMessagesAsAnswered,
	getUnansweredMessages,
	getMode,
	ChatMessage
} from './ydb';
import {getGPTResponse, UserMessage} from "./gpt";
import { Who } from './telegram-utils';
import { Message } from 'grammy/types';

export async function chatHandler(ctx: Context, who: Who, message:Message) {
	const chatId = ctx.chat?.id || 0;
	const businessConnectionId = ctx.businessConnectionId || '';
	const messageId = message?.message_id || 0;
	const repliedText = message?.reply_to_message?.text || '';
	const text = message?.text || '';

	await addChatMessage(chatId, messageId, businessConnectionId, text, who, repliedText);
}

export async function handleBatchMessages(
	chatId: number,
	businessConnectionId: string,
	messageIds: number[]
) {
	try {
		const mode = await getMode(chatId);
		const historyMessages = await getLastChatMessages(chatId, businessConnectionId, 30);
		const gptMessages: UserMessage[] = historyMessages.map((v: ChatMessage) => {
			if (v.replied_message) {
				return {
					role: (v.who.role === 'client') ? 'user' : 'assistant',
					text: `Пользователь ответил на сообщение "${v.message}": ${v.replied_message}`
				}
			}
			return {
				role: (v.who.role === 'client' ? 'user' : 'assistant'),
				text: v.message
			}
		});

		const gptResponse = await getGPTResponse(gptMessages, 'base', businessConnectionId, chatId, mode);
		if (gptResponse?.text && !gptResponse.error) {
			const { bot } = await import('./bot-instance');
			const { imitateTypingBatch } = await import('./telegram-utils');
			const textToReply = gptResponse.text;
			const delay = textToReply.length * 200;
			await imitateTypingBatch(bot, chatId, 0, delay, businessConnectionId);

			const currentUnanswered = await getUnansweredMessages(chatId, businessConnectionId);
			const currentIds = currentUnanswered.map((m) => m.messageId);
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
				const who:Who = {
					room: 'chat',
					role: 'user',
					isBot: true,
				};

				await addChatMessage(
					chatId,
					sentMessage.message_id,
					businessConnectionId,
					gptResponse.text,
					who
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