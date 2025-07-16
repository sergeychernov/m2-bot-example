import {
  Driver,
  Logger,
  Types,
  TokenAuthService,
  MetadataAuthService,
  // Ydb, // Может понадобиться для доступа к Ydb.IValue, если не экспортируется иначе

} from 'ydb-sdk';
import crypto from 'crypto';
import { Answered, Mute, Who } from './telegram-utils';

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

export async function addChatMessage(
    chatId: number,
    messageId: number, // Изменено с string на number
    business_connection_id: string, // Заменено userId на business_connection_id
    message: string,
    who: Who,
    answered: Answered,
    repliedText?: string,
    iamToken?: string
): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  const tableName = 'chats';

  const query = `
    PRAGMA TablePathPrefix("${process.env.YDB_DATABASE}");
    DECLARE $chatId AS Int64;
    DECLARE $messageId AS Int64;
    DECLARE $business_connection_id AS Utf8;
    DECLARE $message AS Utf8;
    DECLARE $timestamp AS Timestamp;
    DECLARE $who AS Json;
    DECLARE $answered AS Json;
    DECLARE $replied_message AS Utf8;

    UPSERT INTO ${tableName} (chatId, messageId, business_connection_id, message, timestamp, who, answered, replied_message)
    VALUES ($chatId, $messageId, $business_connection_id, $message, $timestamp, $who, $answered, $replied_message);
  `;

  logger.info(`Executing query: ${JSON.stringify(query)} for chatId: ${chatId}, messageId: ${messageId}, business_connection_id: ${business_connection_id}`);

  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const preparedQuery = await session.prepareQuery(query);
      await session.executeQuery(preparedQuery, {
        '$chatId': { type: Types.INT64, value: { int64Value: chatId } },
        '$messageId': { type: Types.INT64, value: { int64Value: messageId } },
        '$business_connection_id': { type: Types.UTF8, value: { textValue: business_connection_id } },
        '$message': { type: Types.UTF8, value: { textValue: message } },
        '$timestamp': { type: Types.TIMESTAMP, value: { uint64Value: Date.now() * 1000 } },
        '$who': { type: Types.JSON, value: { textValue: JSON.stringify(who) } },
        '$answered': { type: Types.JSON, value: { textValue: JSON.stringify(answered) } },
        '$replied_message': { type: Types.UTF8, value: { textValue: repliedText ?? '' } },
      });
    });
    logger.info(`Successfully added message for chatId: ${chatId}, messageId: ${messageId}, business_connection_id: ${business_connection_id}`);
  } catch (error) {
    logger.error(`Error adding message for chatId: ${chatId}, messageId: ${messageId}, business_connection_id: ${business_connection_id}`, JSON.stringify(error));
    throw error;
  }
}


export async function updateChatMessage(
    chatId: number,
    messageId: number,
    businessConnectionId: string,
    updatedMessage: string,
    iamToken?: string
): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  const tableName = 'chats';
  const query = `
    DECLARE $chatId AS Int64;
    DECLARE $messageId AS Int64;
    DECLARE $businessConnectionId AS Utf8;
    DECLARE $updatedMessage AS Utf8;
    UPDATE ${tableName}
    SET message = $updatedMessage
    WHERE chatId = $chatId AND messageId = $messageId AND business_connection_id = $businessConnectionId;
  `;
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      await session.executeQuery(query, {
        $chatId: { type: Types.INT64, value: { int64Value: chatId } },
        $messageId: { type: Types.INT64, value: { int64Value: messageId } },
        $businessConnectionId: { type: Types.UTF8, value: { textValue: businessConnectionId } },
        $updatedMessage: { type: Types.UTF8, value: { textValue: updatedMessage } },
      });
    });
    logger.info(`Updated messageId=${messageId} in chatId=${chatId} (business_connection_id=${businessConnectionId})`);
  } catch (error) {
    logger.error(`Failed to update messageId=${messageId} in chatId=${chatId} (business_connection_id=${businessConnectionId}):`, error);
    throw error;
  }
}


export async function getLastChatMessages(
  chatId: number,
  business_connection_id: string, // Заменено userId на business_connection_id
  limit: number = 10,
  iamToken?: string
): Promise<ChatMessage[]> {
  const currentDriver = await getDriver(iamToken);
  const tableName = 'chats';

  const query = `
    PRAGMA TablePathPrefix("${process.env.YDB_DATABASE}");
    DECLARE $chatId AS Int64;
    DECLARE $business_connection_id AS Utf8;
    DECLARE $limit AS Uint64;

    SELECT chatId, messageId, business_connection_id, message, timestamp, who, answered, replied_message
    FROM ${tableName}
    WHERE chatId = $chatId AND business_connection_id = $business_connection_id
    ORDER BY timestamp DESC
    LIMIT $limit;
  `;

  logger.info(`Executing query: ${JSON.stringify(query)} for chatId: ${chatId}, business_connection_id: ${business_connection_id}, limit: ${limit}`);

  try {
    const messages: ChatMessage[] = [];
    await currentDriver.tableClient.withSession(async (session) => {
      const preparedQuery = await session.prepareQuery(query);
      const { resultSets } = await session.executeQuery(preparedQuery, {
        '$chatId': { type: Types.INT64, value: { int64Value: chatId } },
        '$business_connection_id': { type: Types.UTF8, value: { textValue: business_connection_id } },
        '$limit': { type: Types.UINT64, value: { uint64Value: limit } },
      });

      if (resultSets[0]?.rows) {
        for (const row of resultSets[0].rows) {
          messages.push({
            chatId: Number(row.items![0].int64Value),
            messageId: Number(row.items![1].int64Value), // Изменено на Number
            business_connection_id: row.items![2].textValue!, // Заменено userId
            message: row.items![3].textValue!,
            timestamp: new Date(Number(row.items![4].uint64Value) / 1000),
            who: JSON.parse(row.items![5].textValue!),
            answered: JSON.parse(row.items![6].textValue!),
            replied_message: row.items?.[7]?.textValue ?? ''
          });
        }
      }
    });
    logger.info(`Successfully retrieved ${messages.length} messages for chatId: ${chatId}, business_connection_id: ${business_connection_id}`);
    return messages.reverse();
  } catch (error) {
    logger.error(`Error retrieving messages for chatId: ${chatId}, business_connection_id: ${business_connection_id}`, JSON.stringify(error));
    throw error;
  }
}

export async function getAllUnansweredMessages(): Promise<ChatMessage[]> {
  const currentDriver = await getDriver();
  const tableName = 'chats';
  const query = `
    SELECT chatId, business_connection_id, messageId, message, timestamp, who, answered, replied_message
    FROM ${tableName}
    ORDER BY chatId, business_connection_id, timestamp ASC;
  `;
  const messages: ChatMessage[] = [];

  // если гпт вернет ошибку, то кидать ему запрос не чаще, чем раз в час
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  await currentDriver.tableClient.withSession(async (session) => {
    const { resultSets } = await session.executeQuery(query);
    if (resultSets[0]?.rows) {
      for (const row of resultSets[0].rows) {
        const answeredObj = JSON.parse(row.items![6].textValue!);
        if (!answeredObj.status) {
          if (
            (answeredObj.retry < 2) ||
            (
              answeredObj.retry >= 2 &&
              answeredObj.lastRetryAt &&
              (now - Date.parse(answeredObj.lastRetryAt)) > hourMs
            )
          ) {
            messages.push({
              chatId: Number(row.items![0].int64Value),
              business_connection_id: row.items![1].textValue!,
              messageId: Number(row.items![2].int64Value),
              message: row.items![3].textValue!,
              timestamp: new Date(Number(row.items![4].uint64Value) / 1000),
              who: JSON.parse(row.items![5].textValue!),
              answered: answeredObj,
              replied_message: row.items?.[7]?.textValue ?? ''
            });
          } else {
            logger.info(`[getAllUnansweredMessages] Сообщения chatId=${row.items![0].int64Value}, messageId=${row.items![2].int64Value} нет в списке неотвеченных сообщений, т.к. в предыдущий раз LLM вернула ошибку : status=${answeredObj.status}, retry=${answeredObj.retry}, lastRetryAt=${answeredObj.lastRetryAt}`);
          }
        }
      }
    }
  });
  return messages;
}

export async function clearChatMessages(chatId: number): Promise<void> {
  const driver = await getDriver();
  const tableName = 'chats'; // Имя вашей таблицы

  const query = `
        PRAGMA TablePathPrefix("${process.env.YDB_DATABASE}");
        DECLARE $chatId AS Int64;

        DELETE FROM ${tableName}
        WHERE chatId = $chatId;
    `;

  logger.info(`Executing query: ${JSON.stringify(query)} for chatId: ${chatId}`);

  try {
    await driver.tableClient.withSession(async (session) => {
      const preparedQuery = await session.prepareQuery(query);
      await session.executeQuery(preparedQuery, {
        '$chatId': { type: Types.INT64, value: { int64Value: chatId } },
      });
    });
    logger.info(`Successfully cleared messages for chatId: ${chatId}`);
  } catch (error) {
    logger.error(`Error clearing messages for chatId: ${chatId}`, JSON.stringify(error));
    throw error;
  }
}


export interface ChatMessage {
  chatId: number;
  messageId: number; // Изменено с string на number (INT64)
  business_connection_id: string; // Заменено userId на business_connection_id (UTF8)
  message: string;
  timestamp: Date;
  who: Who;
  answered: Answered;
  replied_message: string;
}

export interface Prompt {
  promptId: string;
  promptText: string;
  greetingPrompt?: string;
  dialogPrompt?: string;
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

  const lastPrompt = await getLatestPromptByType(promptType, iamToken);
  const greetingPrompt = lastPrompt?.greetingPrompt ?? '';
  const dialogPrompt = lastPrompt?.dialogPrompt ?? '';

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
        DECLARE $greetingPrompt AS Utf8;
        DECLARE $dialogPrompt AS Utf8;

        UPSERT INTO prompts (promptId, promptText, promptType, createdAt, model, stream, temperature, maxTokens, greetingPrompt, dialogPrompt)
        VALUES ($promptId, $promptText, $promptType, $createdAt, $model, $stream, $temperature, $maxTokens, $greetingPrompt, $dialogPrompt);
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
        $greetingPrompt: { type: Types.UTF8, value: { textValue: greetingPrompt ?? '' } },
        $dialogPrompt: { type: Types.UTF8, value: { textValue: dialogPrompt ?? '' } },
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

        SELECT promptId, promptText, greetingPrompt, dialogPrompt, promptType, createdAt, model, \`stream\`, temperature, maxTokens
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
            greetingPrompt: row.items[2]?.textValue || '',
            dialogPrompt: row.items[3]?.textValue || '',
            promptType: row.items[4].textValue || '',
            createdAt: new Date(Number(row.items[5].uint64Value) / 1000),
            model: row.items[6].textValue || '',
            stream: row.items[7].boolValue || false,
            temperature: row.items[8].doubleValue || 0.6,
            maxTokens: Number(row.items[9].int64Value) || 20000,
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

export async function updatePromptDetails(
  promptType: string,
  greetingPrompt: string,
  dialogPrompt: string,
  iamToken?: string
): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  const lastPrompt = await getLatestPromptByType(promptType, iamToken);
  if (!lastPrompt) throw new Error('No prompt found to update');
  const query = `
    UPDATE prompts
    SET greetingPrompt = $greetingPrompt, dialogPrompt = $dialogPrompt
    WHERE promptId = $promptId;
  `;
  await currentDriver.tableClient.withSession(async (session) => {
    await session.executeQuery(query, {
      $promptId: { type: Types.UTF8, value: { textValue: lastPrompt.promptId } },
      $greetingPrompt: { type: Types.UTF8, value: { textValue: greetingPrompt } },
      $dialogPrompt: { type: Types.UTF8, value: { textValue: dialogPrompt } },
    });
  });
}

export async function closeDriver() {
  if (driver) {
    await driver.destroy();
    driver = undefined;
    logger.info('Driver destroyed');
  }
}

export interface Client {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  quickMode: boolean;
  mute: Mute;
}

const clientCache = new Map<number, Client>();

export async function getClient(id: number, iamToken?: string): Promise<Client | null> {
  if (clientCache.has(id)) {
    logger.info(`Returning client ${id} from cache.`);
    return clientCache.get(id)!;
  }

  logger.info(`Client ${id} not in cache, fetching from DB.`);
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $id AS Int64;
        SELECT id, first_name, last_name, username, language_code, quickMode, mute FROM clients WHERE id = $id LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $id: { type: Types.INT64, value: { int64Value: id } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        if (row.items) {
          const client: Client = {
            id: Number(row.items[0].int64Value),
            first_name: row.items[1].textValue ?? undefined,
            last_name: row.items[2].textValue ?? undefined,
            username: row.items[3].textValue ?? undefined,
            language_code: row.items[4].textValue ?? undefined,
            quickMode: typeof row.items[5]?.boolValue === 'boolean' ? row.items[5].boolValue : false,
            mute: row.items[6]?.textValue ? JSON.parse(row.items[6].textValue) : undefined,
          };
          clientCache.set(id, client);
          logger.info(`Client ${id} fetched from DB and cached.`);
          return client;
        }
      }
      logger.warn(`Client with id ${id} not found in DB.`);
      return null;
    });
  } catch (error) {
    logger.error('Failed to get client data:', error);
    throw error;
  }
}

export async function setClient(client: Client, iamToken?: string): Promise<void> {
  const cachedClient = clientCache.get(client.id);
  if (cachedClient && JSON.stringify(cachedClient) === JSON.stringify(client)) {
    logger.info(`Client data for ${client.id} is up to date, no changes made.`);
    return;
  }

  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $id AS Int64;
        DECLARE $first_name AS Utf8?;
        DECLARE $last_name AS Utf8?;
        DECLARE $username AS Utf8?;
        DECLARE $language_code AS Utf8?;
        DECLARE $quickMode AS Bool?;
        UPSERT INTO clients (id, first_name, last_name, username, language_code, quickMode, mute)
        VALUES ($id, $first_name, $last_name, $username, $language_code, $quickMode, $mute);
      `;

      await session.executeQuery(query, {
        $id: { type: Types.INT64, value: { int64Value: client.id } },
        $first_name: { type: Types.optional(Types.UTF8), value: client.first_name ? { textValue: client.first_name } : { nullFlagValue: 0 } },
        $last_name: { type: Types.optional(Types.UTF8), value: client.last_name ? { textValue: client.last_name } : { nullFlagValue: 0 } },
        $username: { type: Types.optional(Types.UTF8), value: client.username ? { textValue: client.username } : { nullFlagValue: 0 } },
        $language_code: { type: Types.optional(Types.UTF8), value: client.language_code ? { textValue: client.language_code } : { nullFlagValue: 0 } },
        $quickMode: { type: Types.optional(Types.BOOL), value: client.quickMode ? { boolValue: client.quickMode } : { nullFlagValue: 0 } },
        $mute: {
          type: Types.optional(Types.JSON),
          value: { textValue: JSON.stringify(client.mute ?? { status: false, muteUntil: '' }) }
        },
      });
      clientCache.set(client.id, client);
      logger.info(`Client data for ${client.id} added/updated in 'clients' table.`);
    });
  } catch (error) {
    logger.error('Failed to set client data:', JSON.stringify(error));
    throw error;
  }
}

export async function saveQuizState(
  userId: number,
  step: number,
  answers: Record<string, any>,
  allowExit: boolean
): Promise<void> {
  const currentDriver = await getDriver();
  await currentDriver.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $userId AS Int64;
      DECLARE $step AS Int32;
      DECLARE $answers AS Json;
      DECLARE $allowExit AS Bool;
      UPSERT INTO quiz_states (userId, step, answers, allowExit)
      VALUES ($userId, $step, $answers, $allowExit);
    `;
    await session.executeQuery(query, {
      $userId: { type: Types.INT64, value: { int64Value: userId } },
      $step: { type: Types.INT32, value: { int32Value: step } },
      $answers: { type: Types.JSON, value: { textValue: JSON.stringify(answers) } },
      $allowExit: { type: Types.BOOL, value: { boolValue: allowExit } },
    });
  });
}

export async function loadQuizState(
  userId: number,
): Promise<{ step: number; answers: Record<string, any>; allowExit: boolean } | null> {
  const currentDriver = await getDriver();
  return await currentDriver.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $userId AS Int64;
      SELECT step, answers, allowExit FROM quiz_states
      WHERE userId = $userId
      LIMIT 1;
    `;
    const { resultSets } = await session.executeQuery(query, {
      $userId: { type: Types.INT64, value: { int64Value: userId } },
    });
    if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
      const row = resultSets[0].rows[0];
      if (
        row.items &&
        typeof row.items[0]?.int32Value === 'number' &&
        typeof row.items[1]?.textValue === 'string' &&
        typeof row.items[2]?.boolValue === 'boolean'
      ) {
        return {
          step: row.items[0].int32Value,
          answers: JSON.parse(row.items[1].textValue),
          allowExit: row.items[2].boolValue,
        };
      }
    }
    return null;
  });
}

export async function deleteQuizState(userId: number): Promise<void> {
  const currentDriver = await getDriver();
  await currentDriver.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $userId AS Int64;
      DELETE FROM quiz_states WHERE userId = $userId;
    `;
    await session.executeQuery(query, {
      $userId: { type: Types.INT64, value: { int64Value: userId } },
    });
  });
}

export type UserMode = 'none' // не определенный режим бота
    | 'start'//стартовое сообщение, когда бот делится своими возможностями
    | 'quiz'//режим опроса пользователя
    | 'idle'// режим ожидания новых команд
    | 'demo'// режим демонстрации
    | 'activation';// режим связи админ чата и бизнес чата

export async function getMode(userId: number, iamToken?: string): Promise<UserMode> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
                DECLARE $userId AS Int64;
                SELECT mode FROM users WHERE userId = $userId LIMIT 1;
            `;
      const { resultSets } = await session.executeQuery(query, {
        $userId: { type: Types.INT64, value: { int64Value: userId } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        // Убедимся, что у row.items[0] есть значение, иначе вернем 'none'
        const modeValue = row.items![0].textValue;
        return (modeValue || 'none') as UserMode;
      }
      return 'none';
    });
  } catch (error) {
    logger.error(`Failed to get mode for user ${userId}:`, JSON.stringify(error));
    throw error;
  }
}

export async function setMode(userId: number, mode: UserMode, iamToken?: string): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
                DECLARE $userId AS Int64;
                DECLARE $mode AS Utf8;
                UPSERT INTO users (userId, mode) VALUES ($userId, $mode);
            `;
      await session.executeQuery(query, {
        $userId: { type: Types.INT64, value: { int64Value: userId } },
        $mode: { type: Types.UTF8, value: { textValue: mode } },
      });
      logger.info(`Mode for user ${userId} set to ${mode}.`);
    });
  } catch (error) {
    logger.error(`Failed to set mode for user ${userId}:`, error);
    throw error;
  }
}

export async function saveQuizConfig(quizConfig: any, iamToken?: string): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const timestampMicroseconds = createdAt.getTime() * 1000;
  await currentDriver.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $id AS Utf8;
      DECLARE $quizConfig AS Json;
      DECLARE $createdAt AS Timestamp;
      UPSERT INTO quiz_configs (id, quizConfig, createdAt) VALUES ($id, $quizConfig, $createdAt);
    `;
    await session.executeQuery(query, {
      $id: { type: Types.UTF8, value: { textValue: id } },
      $quizConfig: { type: Types.JSON, value: { textValue: JSON.stringify(quizConfig) } },
      $createdAt: { type: Types.TIMESTAMP, value: { uint64Value: timestampMicroseconds } },
    });
    logger.info(`Quiz config saved to quiz_configs table with id=${id}`);
  });
}

export async function getQuizConfig(iamToken?: string): Promise<any | null> {
  const currentDriver = await getDriver(iamToken);
  return await currentDriver.tableClient.withSession(async (session) => {
    const query = `
      SELECT quizConfig FROM quiz_configs ORDER BY createdAt DESC LIMIT 1;
    `;
    const { resultSets } = await session.executeQuery(query, {});
    if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
      const row = resultSets[0].rows[0];
      if (row.items && row.items[0]?.textValue) {
        return JSON.parse(row.items[0].textValue);
      }
    }
    return null;
  });
}

export async function changeAnsweredStatus(
  chatId: number,
  business_connection_id: string,
  messageIds: number[],
  status: boolean = true
): Promise<void> {
  if (messageIds.length === 0) return;
  const driver = await getDriver();
  await driver.tableClient.withSession(async (session) => {
    for (const messageId of messageIds) {
      const selectQuery = `
        SELECT answered FROM chats
        WHERE chatId = $chatId AND business_connection_id = $business_connection_id AND messageId = $messageId;
      `;
      const { resultSets } = await session.executeQuery(selectQuery, {
        $chatId: { type: Types.INT64, value: { int64Value: chatId } },
        $business_connection_id: { type: Types.UTF8, value: { textValue: business_connection_id } },
        $messageId: { type: Types.INT64, value: { int64Value: messageId } },
      });

      let answeredObj = { status: false, retry: 0, lastRetryAt: new Date().toISOString() };

      if (resultSets[0]?.rows?.[0]?.items?.[0]?.textValue) {
        try {
          answeredObj = JSON.parse(resultSets[0].rows[0].items[0].textValue);
        } catch (e) {
          answeredObj = { status: false, retry: 0, lastRetryAt: new Date().toISOString() };
        }
      }

      answeredObj.status = status;
      answeredObj.retry = (answeredObj.retry || 0) + 1;
      answeredObj.lastRetryAt = new Date().toISOString();

      const updateQuery = `
        DECLARE $chatId AS Int64;
        DECLARE $business_connection_id AS Utf8;
        DECLARE $messageId AS Int64;
        DECLARE $answered AS Json;
        UPDATE chats
        SET answered = $answered
        WHERE chatId = $chatId AND business_connection_id = $business_connection_id AND messageId = $messageId;
      `;
      await session.executeQuery(updateQuery, {
        $chatId: { type: Types.INT64, value: { int64Value: chatId } },
        $business_connection_id: { type: Types.UTF8, value: { textValue: business_connection_id } },
        $messageId: { type: Types.INT64, value: { int64Value: messageId } },
        $answered: { type: Types.JSON, value: { textValue: JSON.stringify(answeredObj) } },
      });
    }
  });
}

export async function updateUserBusinessConnection(userId: number, businessConnectionId: string, iamToken?: string): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $userId AS Int64;
        DECLARE $businessConnectionId AS Utf8;
        
        UPSERT INTO users (userId, business_connection_id)
        VALUES ($userId, $businessConnectionId);
      `;
      await session.executeQuery(query, {
        $userId: { type: Types.INT64, value: { int64Value: userId } },
        $businessConnectionId: { type: Types.UTF8, value: { textValue: businessConnectionId } },
      });
      logger.info(`Business connection ID ${businessConnectionId} updated for user ${userId} in 'users' table.`);
    });
  } catch (error) {
    logger.error('Failed to update user business connection:', error);
    throw error;
  }
}