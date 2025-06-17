import { Column, TableDescription, Types } from 'ydb-sdk';
import { closeDriver, getDriver, logger, addPrompt } from './ydb';
import fs from 'fs'; // Добавляем импорт fs
import path from 'path'; // Добавляем импорт path

async function ensureChatsTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
	  await currentDriver.tableClient.withSession(async (session) => {
		try {
		  await session.describeTable('chats');
		  logger.info("Table 'chats' already exists.");
		} catch (error: any) {
		  logger.info("Table 'chats' not found, creating...");
		  await session.createTable(
			'chats',
			new TableDescription()
			  .withColumn(new Column('chatId', Types.UTF8))
			  .withColumn(new Column('messageId', Types.UTF8))
			  .withColumn(new Column('message', Types.UTF8))
			  .withColumn(new Column('timestamp', Types.TIMESTAMP))
			  .withColumn(new Column('type', Types.UTF8)) // Добавлено новое поле type
			  .withPrimaryKeys('chatId', 'messageId')
		  );
		  logger.info("Table 'chats' created successfully.");
		}
	  });
	} catch (error) {
	  logger.error('Failed to ensure chats table exists:', error);
	  throw error; // Перебрасываем ошибку, чтобы вызывающий код мог ее обработать
	} finally {
	  // Важно: драйвер, созданный в getDriver, должен быть закрыт,
	  // если он не будет использоваться дальше. 
	  // Текущая реализация closeDriver() работает с глобальной переменной,
	  // что может потребовать пересмотра архитектуры управления драйверами.
	  // Для простоты здесь не вызываем currentDriver.destroy(), 
	  // предполагая, что управление жизненным циклом драйвера происходит выше.
	}
}
  
async function ensurePromptsTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
	  await currentDriver.tableClient.withSession(async (session) => {
		try {
		  await session.describeTable('prompts');
		  logger.info("Table 'prompts' already exists.");
		} catch (error: any) {
		  logger.info("Table 'prompts' not found, creating...");
		  await session.createTable(
			'prompts',
			new TableDescription()
			  .withColumn(new Column('promptId', Types.UTF8))
			  .withColumn(new Column('promptText', Types.UTF8))
			  .withColumn(new Column('promptType', Types.UTF8))
			  .withColumn(new Column('createdAt', Types.TIMESTAMP))
			  .withPrimaryKeys('promptId')
		  );
		  logger.info("Table 'prompts' created successfully.");
  
		  // Добавляем базовый промпт из файла после создания таблицы
		  try {
			const promptFilePath = path.resolve(__dirname, 'system_prompt.md');
			const initialPromptText = fs.readFileSync(promptFilePath, 'utf-8');
			// Вызываем addPrompt внутри той же сессии, если это возможно и эффективно,
			// или просто вызываем как отдельную транзакцию.
			// Для простоты здесь вызываем как отдельную операцию.
			await addPrompt(initialPromptText, 'base', iamToken); 
			logger.info('Initial base prompt added to DB from system_prompt.md after table creation.');
		  } catch (fileError) {
			logger.error('Failed to read system_prompt.md to populate initial prompt after table creation:', fileError);
		  }
		}
	  });
	} catch (error) {
	  logger.error('Failed to ensure prompts table exists:', error);
	  throw error;
	}
  }
export async function setupDatabase() {
  try {
    console.log('Starting database setup...');
    await ensureChatsTableExists();
    await ensurePromptsTableExists();
    console.log('Database setup completed successfully.');
  } catch (error) {
    console.error('Failed to setup database:', error);
    process.exit(1); // Выход с ошибкой, если настройка не удалась
  } finally {
    await closeDriver(); // Убедитесь, что функция closeDriver экспортируется из ydb.ts и корректно закрывает соединение
    console.log('Database connection closed.');
  }
}