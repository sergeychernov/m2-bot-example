import { getAllUnansweredMessages } from './ydb';
import { handleBatchMessages } from './chat-handler';
import groupBy from 'lodash/groupBy';

export async function processAllUnansweredChats() {
  const allUnanswered = await getAllUnansweredMessages();

  const grouped = groupBy(allUnanswered, msg => `${msg.chatId}:${msg.business_connection_id}`);

  for (const key in grouped) {
    const [chatId, business_connection_id] = key.split(':');
    const messages = grouped[key];
    const messageIds = messages.map(m => m.messageId);
    await handleBatchMessages(Number(chatId), business_connection_id, messageIds);
  }
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