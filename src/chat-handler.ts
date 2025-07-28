import { Context } from 'grammy';
import {
	addChatMessage,
	getLastChatMessages,
	changeAnsweredStatus,
	getMode,
	ChatMessage,
	getAllUnansweredMessages,
	isUserOnline
} from './ydb';
import {getGPTResponse, loadGptSettingsFromDb, UserMessage} from "./gpt";
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
	const text = message?.text || message?.sticker?.emoji || '';

	if (quickMode) {
		await addChatMessage(chatId, messageId, businessConnectionId, text, who, { status: true, retry: 0, lastRetryAt: new Date().toISOString() }, repliedText);
		await handleMessagesInQuickMode(chatId, businessConnectionId);
	} else {
		await addChatMessage(chatId, messageId, businessConnectionId, text, who, {
			status: false,
			retry: 0,
			lastRetryAt: new Date().toISOString()
		}, repliedText,);
	}
}

export async function handleBatchMessages(
	chatId: number,
	businessConnectionId: string,
	messageIds: number[]
) {
	try {
		const [historyMessages, gptSettings] = await Promise.all([
			getLastChatMessages(chatId, businessConnectionId),
			loadGptSettingsFromDb('base')
		]);

		// если риелтор сам отвечает клиенту
		const isOnlineUser = await isUserOnline(gptSettings?.pauseBotTime, historyMessages);
		if (isOnlineUser) {
			console.log(`[handleBatchMessages] Пользователь онлайн, бот не отвечает (chatId=${chatId})`);
			return;
		}

		const gptMessages = buildGptMessages(historyMessages);
		const mode = await getMode(chatId);
		const gptResponse = await getGPTResponse(gptMessages, 'base', businessConnectionId, chatId, mode);

		if (!isOnlineUser && gptResponse?.text && !gptResponse.error) {
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
				await changeAnsweredStatus(chatId, businessConnectionId, messageIds, true);
			} catch (e: any) {
				if (e.description?.includes('BUSINESS_PEER_INVALID')) {
					await changeAnsweredStatus(chatId, businessConnectionId, messageIds, true);
					console.warn('Ответ не доставлен из-за того, что пользователь отключил бот, BUSINESS_PEER_INVALID');
				} else {
					throw e;
				}
			}
		} else {
			console.error(`[handleBatchMessages] Ошибка от gpt в чате ${chatId}, сообщения НЕ помечаем как отвеченные:`, gptResponse?.text);
			await changeAnsweredStatus(chatId, businessConnectionId, messageIds, false);
		}
	} catch (err) {
		console.error('[handleBatchMessages] Ошибка при обработке сообщений:', err, {
			chatId,
			businessConnectionId,
			messageIds
		});
		throw err;
	}
}

export async function handleMessagesInQuickMode(
	chatId: number,
	businessConnectionId: string,
) {
	try {
		const mode = await getMode(chatId);
		const historyMessages = await getLastChatMessages(chatId, businessConnectionId);
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
	await addChatMessage(chatId, sentMessage.message_id, businessConnectionId, text, who, { status: true, retry: 0, lastRetryAt: new Date().toISOString() });
	return sentMessage;
}