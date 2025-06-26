import { getChatsWithUnansweredMessages, getUnansweredMessages, markMessagesAsAnswered } from './ydb';
import { handleBatchMessages } from './chat-handler';

export async function processAllUnansweredChats() {
  const chats = await getChatsWithUnansweredMessages();
  await Promise.all(
    chats.map(async ({ chatId, userId }) => {
      const messages = await getUnansweredMessages(chatId, userId);
      if (messages.length > 0) {
        const messageIds = messages.map(m => m.messageId);
        await handleBatchMessages(chatId, userId, messageIds);
        await markMessagesAsAnswered(chatId, userId, messageIds);
      }
    })
  );
}

export async function handler(event: any, context?: any) {
  try {
    await processAllUnansweredChats();
    return { statusCode: 200, body: 'Unanswered chats processed' };
  } catch (error) {
    console.error('Error processing unanswered chats:', error);
    return { statusCode: 500, body: 'Error processing unanswered chats' };
  }
} 