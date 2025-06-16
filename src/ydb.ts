import {
    Driver, 
    Logger, 
    TableDescription, 
    Column,           
    Types,            
  TokenAuthService,
  MetadataAuthService,
  // Ydb, // Может понадобиться для доступа к Ydb.IValue, если не экспортируется иначе
} from 'ydb-sdk';

const endpoint = process.env.YDB_ENDPOINT;
const database = process.env.YDB_DATABASE;


if (!endpoint || !database) {
  throw new Error('YDB_ENDPOINT or/and YDB_DATABASE environment variable must be set.');
}

let driver: Driver | undefined;

const logger = {
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

export async function ensureChatsTableExists(iamToken?: string): Promise<void> {
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

export async function closeDriver() {
  if (driver) {
    await driver.destroy();
    driver = undefined;
    logger.info('Driver destroyed');
  }
}
