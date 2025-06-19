import {
    Driver, 
    Logger,       
    Types,            
  TokenAuthService,
  MetadataAuthService,
  // Ydb, // Может понадобиться для доступа к Ydb.IValue, если не экспортируется иначе

} from 'ydb-sdk';
import crypto from 'crypto'; // Добавили импорт crypto

const endpoint = process.env.YDB_ENDPOINT;
const database = process.env.YDB_DATABASE;

if (!endpoint || !database) {
  throw new Error('YDB_ENDPOINT or/and YDB_DATABASE environment variable must be set.');
}

let driver: Driver | undefined;

export const logger = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    fatal: console.error, 
    trace: console.trace,
} as Logger;


export async function getDriver(iamToken?: string): Promise<Driver> {
  if (driver) {
    return driver;
  }
  const authService = iamToken ? new TokenAuthService(iamToken) : new MetadataAuthService();
 driver = new Driver({
  endpoint,
  database,
  authService,
 });
 if (!await driver.ready(10000)) {
  logger.fatal('Driver has not become ready in 10 seconds!');
  throw new Error('Driver has not become ready in 10 seconds!');
}
  return driver;
}

export type ChatMessageType = 'bot' | 'client' | 'realtor' | 'admin';

export async function addChatMessage(
  chatId: string,
  messageId: string,
  message: string,
  type: ChatMessageType,
  iamToken?: string
): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $chatId AS Utf8;
        DECLARE $messageId AS Utf8;
        DECLARE $message AS Utf8;
        DECLARE $type AS Utf8;
        DECLARE $timestamp AS Timestamp;

        UPSERT INTO chats (chatId, messageId, message, type, timestamp)
        VALUES ($chatId, $messageId, $message, $type, $timestamp);
      `;

      const now = new Date();
      // Преобразуем миллисекунды в микросекунды. YDB ожидает микросекунды для Timestamp.
      const timestampMicroseconds = now.getTime() * 1000;

      await session.executeQuery(query, {
        $chatId: { type: Types.UTF8, value: { textValue: chatId } },
        $messageId: { type: Types.UTF8, value: { textValue: messageId } },
        $message: { type: Types.UTF8, value: { textValue: message } },
        $type: { type: Types.UTF8, value: { textValue: type } },
        $timestamp: { type: Types.TIMESTAMP, value: { uint64Value: timestampMicroseconds } }, 
      });
      logger.info(`Message ${messageId} for chat ${chatId} added to 'chats' table.`);
    });
  } catch (error) {
    logger.error('Failed to add chat message:', error);
    throw error;
  }
}

export interface ChatMessage {
  chatId: string;
  messageId: string;
  message: string;
  type: ChatMessageType;
  timestamp: Date;
}

export async function getLastChatMessages(chatId: string, limit: number, iamToken?: string): Promise<ChatMessage[]> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $chatId AS Utf8;

        SELECT chatId, messageId, message, type, timestamp
        FROM chats
        WHERE chatId = $chatId
        ORDER BY timestamp DESC
        LIMIT ${limit};
      `;

      const { resultSets } = await session.executeQuery(query, {
        $chatId: { type: Types.UTF8, value: { textValue: chatId } },
      });

      const messages: ChatMessage[] = [];
      if (resultSets[0]?.rows) {
        for (const row of resultSets[0].rows) {
          if (row.items) {
            messages.push({
              chatId: row.items[0].textValue || '',
              messageId: row.items[1].textValue || '',
              message: row.items[2].textValue || '',
              type: (row.items[3].textValue || 'client') as ChatMessageType, // Приведение типа, возможно, потребуется более строгая проверка
              timestamp: new Date(Number(row.items[4].uint64Value) / 1000), 
            });
          }
        }
      }
      logger.info(`Retrieved last ${limit} messages for chat ${chatId}. Found: ${messages.length}`);
      return messages.reverse(); // Возвращаем в хронологическом порядке (старые -> новые)
    });
  } catch (error) {
    logger.error(`Failed to get last ${limit} chat messages for chatId ${chatId}:`, JSON.stringify(error));
    throw error;
  }
}

export async function clearChatMessages(chatId: string): Promise<void> {
    const driver = await getDriver();
    const tableName = 'chats'; // Имя вашей таблицы

    const query = `
        PRAGMA TablePathPrefix("${process.env.YDB_DATABASE}");
        DECLARE $chatId AS Utf8;

        DELETE FROM ${tableName}
        WHERE chatId = $chatId;
    `;

    logger.info(`Executing query: ${query} for chatId: ${chatId}`);

    try {
        await driver.tableClient.withSession(async (session) => {
            const preparedQuery = await session.prepareQuery(query);
            await session.executeQuery(preparedQuery, {
                '$chatId': { type: Types.UTF8, value: { textValue: chatId } },
            });
        });
        logger.info(`Successfully cleared messages for chatId: ${chatId}`);
    } catch (error) {
        logger.error(`Error clearing messages for chatId: ${chatId}`, error);
        throw error;
    }
}


export interface Prompt {
  promptId: string;
  promptText: string;
  promptType: string;
  createdAt: Date;
  model: string; // Новое поле
  stream: boolean; // Новое поле
  temperature: number; // Новое поле
  maxTokens: number; // Новое поле
}



export async function addPrompt(
  promptText: string,
  promptType: string,
  model: string, // Новый параметр
  stream: boolean, // Новый параметр
  temperature: number, // Новый параметр
  maxTokens: number, // Новый параметр
  iamToken?: string
): Promise<string> {
  const currentDriver = await getDriver(iamToken);
  const promptId = crypto.randomUUID(); // Генерируем UUID для promptId
  const createdAt = new Date();

  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $promptId AS Utf8;
        DECLARE $promptText AS Utf8;
        DECLARE $promptType AS Utf8;
        DECLARE $createdAt AS Timestamp;
        DECLARE $model AS Utf8;
        DECLARE $stream AS Bool;
        DECLARE $temperature AS Double;
        DECLARE $maxTokens AS Int64;

        UPSERT INTO prompts (promptId, promptText, promptType, createdAt, model, stream, temperature, maxTokens)
        VALUES ($promptId, $promptText, $promptType, $createdAt, $model, $stream, $temperature, $maxTokens);
      `;

      const timestampMicroseconds = createdAt.getTime() * 1000;

      await session.executeQuery(query, {
        $promptId: { type: Types.UTF8, value: { textValue: promptId } },
        $promptText: { type: Types.UTF8, value: { textValue: promptText } },
        $promptType: { type: Types.UTF8, value: { textValue: promptType } },
        $createdAt: { type: Types.TIMESTAMP, value: { uint64Value: timestampMicroseconds } },
        $model: { type: Types.UTF8, value: { textValue: model } },
        $stream: { type: Types.BOOL, value: { boolValue: stream } },
        $temperature: { type: Types.DOUBLE, value: { doubleValue: temperature } },
        $maxTokens: { type: Types.INT64, value: { int64Value: maxTokens } },
      });
      logger.info(`Prompt ${promptId} of type ${promptType} added to 'prompts' table.`);
    });
    return promptId;
  } catch (error) {
    logger.error('Failed to add prompt:', error);
    throw error;
  }
}

export async function getLatestPromptByType(promptType: string, iamToken?: string): Promise<Prompt | null> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $promptType AS Utf8;

        SELECT promptId, promptText, promptType, createdAt, model, \`stream\`, temperature, maxTokens
        FROM prompts
        WHERE promptType = $promptType
        ORDER BY createdAt DESC
        LIMIT 1;
      `;

      const { resultSets } = await session.executeQuery(query, {
        $promptType: { type: Types.UTF8, value: { textValue: promptType } },
      });

      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        if (row.items) {
          return {
            promptId: row.items[0].textValue || '',
            promptText: row.items[1].textValue || '',
            promptType: row.items[2].textValue || '',
            createdAt: new Date(Number(row.items[3].uint64Value) / 1000),
            model: row.items[4].textValue || '',
            stream: row.items[5].boolValue || false,
            temperature: row.items[6].doubleValue || 0.6,
            maxTokens: Number(row.items[7].int64Value) || 20000,
          };
        }
      }
      logger.info(`No prompt found for type ${promptType}.`);
      return null;
    });
  } catch (error) {
    logger.error(`Failed to get latest prompt for type ${promptType}:`, JSON.stringify(error));
    throw error;
  }
}


export async function closeDriver() {
  if (driver) {
    await driver.destroy();
    driver = undefined;
    logger.info('Driver destroyed');
  }
}

export interface User {
  userId: string;
  firstName: string;
  lastName: string;
  occupation: string;
  experience: string;
  dealTypes: string;
  workStyle: string;
  usageGoal: string;
  phone: string;
  email: string;
}

export async function addUser(user: User, iamToken?: string): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $userId AS Utf8;
        DECLARE $firstName AS Utf8;
        DECLARE $lastName AS Utf8;
        DECLARE $occupation AS Utf8;
        DECLARE $experience AS Utf8;
        DECLARE $dealTypes AS Utf8;
        DECLARE $workStyle AS Utf8;
        DECLARE $usageGoal AS Utf8;
        DECLARE $phone AS Utf8;
        DECLARE $email AS Utf8;

        UPSERT INTO users (userId, firstName, lastName, occupation, experience, dealTypes, workStyle, usageGoal, phone, email)
        VALUES ($userId, $firstName, $lastName, $occupation, $experience, $dealTypes, $workStyle, $usageGoal, $phone, $email);
      `;
      await session.executeQuery(query, {
        $userId: { type: Types.UTF8, value: { textValue: user.userId } },
        $firstName: { type: Types.UTF8, value: { textValue: user.firstName } },
        $lastName: { type: Types.UTF8, value: { textValue: user.lastName } },
        $occupation: { type: Types.UTF8, value: { textValue: user.occupation } },
        $experience: { type: Types.UTF8, value: { textValue: user.experience } },
        $dealTypes: { type: Types.UTF8, value: { textValue: user.dealTypes } },
        $workStyle: { type: Types.UTF8, value: { textValue: user.workStyle } },
        $usageGoal: { type: Types.UTF8, value: { textValue: user.usageGoal } },
        $phone: { type: Types.UTF8, value: { textValue: user.phone } },
        $email: { type: Types.UTF8, value: { textValue: user.email } },
      });
      logger.info(`User ${user.userId} added/updated in 'users' table.`);
    });
  } catch (error) {
    logger.error('Failed to add user:', error);
    throw error;
  }
}

export async function getUser(userId: string, iamToken?: string): Promise<User | null> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $userId AS Utf8;
        SELECT userId, firstName, lastName, occupation, experience, dealTypes, workStyle, usageGoal, phone, email
        FROM users
        WHERE userId = $userId
        LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $userId: { type: Types.UTF8, value: { textValue: userId } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        if (row.items) {
          return {
            userId: row.items[0].textValue || '',
            firstName: row.items[1].textValue || '',
            lastName: row.items[2].textValue || '',
            occupation: row.items[3].textValue || '',
            experience: row.items[4].textValue || '',
            dealTypes: row.items[5].textValue || '',
            workStyle: row.items[6].textValue || '',
            usageGoal: row.items[7].textValue || '',
            phone: row.items[8].textValue || '',
            email: row.items[9].textValue || '',
          };
        }
      }
      return null;
    });
  } catch (error) {
    logger.error('Failed to get user:', error);
    throw error;
  }
}
