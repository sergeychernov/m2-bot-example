import { getAllUnansweredMessages } from './ydb';
import { handleBatchMessages } from './chat-handler';

export async function processAllUnansweredChats() {
  const allUnanswered = await getAllUnansweredMessages();

  const grouped: Record<string, typeof allUnanswered> = {};
  for (const msg of allUnanswered) {
    const key = `${msg.chatId}:${msg.business_connection_id}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(msg);
  }

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