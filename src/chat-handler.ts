import { Context } from 'grammy';
import {
	addChatMessage,
	getLastChatMessages,
	markMessagesAsAnswered,
	getMode,
	ChatMessage,
	getAllUnansweredMessages
} from './ydb';
import {getGPTResponse, UserMessage} from "./gpt";
import { Who } from './telegram-utils';
import { Message } from 'grammy/types';

export async function chatHandler(
	ctx: Context,
	who: Who,
	message: Message,
	quickMode: boolean = false
) {
	const chatId = ctx.chat?.id || 0;
	const businessConnectionId = ctx.businessConnectionId || '';
	const messageId = message?.message_id || 0;
	const repliedText = message?.reply_to_message?.text || '';
	const text = message?.text || '';

	if (quickMode) {
		await addChatMessage(chatId, messageId, businessConnectionId, text, who, repliedText, true);
		await handleMessagesInQuickMode(chatId, businessConnectionId);
	} else {
		await addChatMessage(chatId, messageId, businessConnectionId, text, who, repliedText);
	}
}

export async function handleBatchMessages(
	chatId: number,
	businessConnectionId: string,
	messageIds: number[]
) {
	try {
		const mode = await getMode(chatId);
		const historyMessages = await getLastChatMessages(chatId, businessConnectionId, 30);
		const gptMessages = buildGptMessages(historyMessages);
		const gptResponse = await getGPTResponse(gptMessages, 'base', businessConnectionId, chatId, mode);
		if (gptResponse?.text && !gptResponse.error) {
			const { bot } = await import('./bot-instance');
			const { imitateTypingBatch } = await import('./telegram-utils');
			const textToReply = gptResponse.text;
			const delay = textToReply.length * 200;
			await imitateTypingBatch(bot, chatId, 0, delay, businessConnectionId);

			const allUnanswered = await getAllUnansweredMessages();
			const currentUnanswered = allUnanswered.filter(
				m => m.chatId === chatId && m.business_connection_id === businessConnectionId
			);
			const currentIds = currentUnanswered.map((m) => m.messageId);
			if (
				currentIds.length > messageIds.length ||
				!messageIds.every(id => currentIds.includes(id))
			) {
				console.log('Появились новые сообщения во время имитации тайпинга, обработка прервана');
				return;
			}

			try {
				await sendAndSaveBotReply(bot, chatId, businessConnectionId, gptResponse.text);
				await markMessagesAsAnswered(chatId, businessConnectionId, messageIds);
			} catch (e: any) {
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

export async function handleMessagesInQuickMode(
	chatId: number,
	businessConnectionId: string,
) {
	try {
		const mode = await getMode(chatId);
		const historyMessages = await getLastChatMessages(chatId, businessConnectionId, 30);
		const gptMessages = buildGptMessages(historyMessages);
		const gptResponse = await getGPTResponse(gptMessages, 'base', businessConnectionId, chatId, mode);
		if (gptResponse?.text && !gptResponse.error) {
			const { bot } = await import('./bot-instance');
			try {
				await sendAndSaveBotReply(bot, chatId, businessConnectionId, gptResponse.text);
			} catch (e: any) {
				throw e;
			}
		} else {
			console.error('[handleMessagesInQuickMode] Ошибка от gpt в режиме quick:', gptResponse?.text);
		}
	} catch (error) {
		console.error('Ошибка при ответе на сообщение от клиента в режиме quick:', JSON.stringify(error));
	}
}

function buildGptMessages(historyMessages: ChatMessage[]): UserMessage[] {
	return historyMessages.map((v: ChatMessage) => {
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
}

async function sendAndSaveBotReply(
	bot: any,
	chatId: number,
	businessConnectionId: string,
	text: string
) {
	const sentMessage = businessConnectionId
		? await bot.api.sendMessage(chatId, text, { business_connection_id: businessConnectionId })
		: await bot.api.sendMessage(chatId, text);
	const who: Who = {
		room: 'chat',
		role: 'user',
		isBot: true,
	};
	await addChatMessage(
		chatId,
		sentMessage.message_id,
		businessConnectionId,
		text,
		who
	);
	return sentMessage;
}