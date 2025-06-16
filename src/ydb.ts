import {
    Driver, 
    Logger, 
    TableDescription, // Добавлено
    Column,           // Добавлено
    Types,            // Добавлено
  TokenAuthService,
  MetadataAuthService
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
        // Предполагаем, что ошибка означает, что таблица не найдена.
        // В реальном приложении лучше проверять тип ошибки.
        logger.info("Table 'chats' not found, creating...");
        await session.createTable(
          'chats',
          new TableDescription()
            .withColumn(new Column('chatId', Types.UTF8))      // String -> UTF8
            .withColumn(new Column('messageId', Types.UTF8)) // String -> UTF8
            .withColumn(new Column('message', Types.UTF8))   // String -> UTF8
            .withColumn(new Column('timestamp', Types.TIMESTAMP)) // timestamp -> TIMESTAMP
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

export async function closeDriver() {
  if (driver) {
    await driver.destroy();
    driver = undefined;
    logger.info('Driver destroyed');
  }
}
