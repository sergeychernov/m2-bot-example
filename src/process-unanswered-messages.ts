import { getAllUnansweredMessages } from './ydb';
import { handleBatchMessages } from './chat-handler';
import groupBy from 'lodash/groupBy';
import type { ChatMessage } from './ydb';

export type UnansweredGroup = {
  chatId: number;
  business_connection_id: string;
  messages: ChatMessage[];
  messageIds: number[];
};

export async function getGroupedUnansweredChats(): Promise<UnansweredGroup[]> {
  const allUnanswered = await getAllUnansweredMessages();
  const grouped = groupBy(allUnanswered, msg => `${msg.chatId}:${msg.business_connection_id}`);

  return Object.entries(grouped).map(([key, messages]) => {
    const [chatId, business_connection_id] = key.split(':');
    return {
      chatId: Number(chatId),
      business_connection_id,
      messages,
      messageIds: messages.map(m => m.messageId),
    };
  });
}

export async function getUnansweredMessageIds(chatId: number, business_connection_id: string): Promise<number[]> {
  const groups = await getGroupedUnansweredChats();
  const group = groups.find(g => g.chatId === chatId && g.business_connection_id === business_connection_id);
  return group ? group.messageIds : [];
}

export async function processAllUnansweredChats() {
  const groups = await getGroupedUnansweredChats();
  for (const group of groups) {
    await handleBatchMessages(group.chatId, group.business_connection_id, group.messageIds);
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