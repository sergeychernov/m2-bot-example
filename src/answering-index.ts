import { processAllUnansweredChats } from './process-unanswered-messages';
import { iam } from './iam';
import { setIamToken } from './gpt';
import { getDriver, closeDriver } from './ydb';
import { setupDatabase } from './setup-db';

export async function handler(event: any, context?: any) {
  const iamToken = iam(context);
  setIamToken(iamToken);

  if (event.setup_database === true) {
    try {
      await setupDatabase();
      return { statusCode: 200, body: 'DB initialized successfully.' };
    } catch (dbError) {
      console.error('DB setup failed:', dbError);
      return { statusCode: 500, body: 'DB setup failed.' };
    } finally {
      await closeDriver();
    }
  }

  if (event?.details?.payload) {
    try {
      const payload = JSON.parse(event.details.payload);
      if (payload.replies_scheduler && iamToken) {
        await getDriver(iamToken); // Убедимся что драйвер создан
        await processAllUnansweredChats();
        return { statusCode: 200, body: 'Unanswered chats processed (from cron)' };
      }
    } catch (e) {
      console.error('Failed to parse timer payload:', e);
      return { statusCode: 400, body: 'Invalid timer payload' };
    } finally {
        await closeDriver();
    }
  }

  return { statusCode: 200, body: 'OK. No action taken.' };
}