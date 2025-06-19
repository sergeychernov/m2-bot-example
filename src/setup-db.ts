import { Column, Driver, TableDescription, Types } from 'ydb-sdk';
import { closeDriver, getDriver, logger, addPrompt } from './ydb';
import fs from 'fs'; // Добавляем импорт fs
import path from 'path'; // Добавляем импорт path
import { migrations, Migration } from './migrations'; // Импортируем миграции
import { TypedData } from 'ydb-sdk'; // Импортируем TypedData

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

async function ensureMigrationsTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
	  await currentDriver.tableClient.withSession(async (session) => {
		try {
		  await session.describeTable('migrations');
		  logger.info("Table 'migrations' already exists.");
		} catch (error: any) {
		  logger.info("Table 'migrations' not found, creating...");
		  await session.createTable(
			'migrations',
			new TableDescription()
			  .withColumn(new Column('version', Types.UINT64)) // Используем UINT64 для числового PK
			  .withColumn(new Column('migration', Types.UTF8))
			  .withColumn(new Column('timestamp', Types.TIMESTAMP))
			  .withPrimaryKeys('version')
		  );
		  logger.info("Table 'migrations' created successfully.");
		}
	  });
	} catch (error) {
	  logger.error('Failed to ensure migrations table exists:', error);
	  throw error;
	}
  }

async function ensureUsersTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
		await currentDriver.tableClient.withSession(async (session) => {
			try {
				await session.describeTable('users');
				logger.info("Table 'users' already exists.");
			} catch (error: any) {
				logger.info("Table 'users' not found, creating...");
				await session.createTable(
					'users',
					new TableDescription()
						.withColumn(new Column('userId', Types.UTF8)) // PK
						.withColumn(new Column('firstName', Types.UTF8))
						.withColumn(new Column('lastName', Types.UTF8))
						.withColumn(new Column('occupation', Types.UTF8))
						.withColumn(new Column('experience', Types.UTF8))
						.withColumn(new Column('dealTypes', Types.UTF8))
						.withColumn(new Column('workStyle', Types.UTF8))
						.withColumn(new Column('usageGoal', Types.UTF8))
						.withColumn(new Column('phone', Types.UTF8))
						.withColumn(new Column('email', Types.UTF8))
						.withPrimaryKeys('userId')
				);
				logger.info("Table 'users' created successfully.");
			}
		});
	} catch (error) {
		logger.error('Failed to ensure users table exists:', error);
		throw error;
	}
}

async function getAppliedMigrations(driver: Driver): Promise<number[]> {
  const appliedVersions: number[] = [];
  try {
    await driver.tableClient.withSession(async (session) => {
      const query = `SELECT version FROM migrations;`;
      const { resultSets } = await session.executeQuery(query);
      if (resultSets[0]?.rows) {
        for (const row of resultSets[0].rows) {
          if (row.items && row.items[0].uint64Value) {
            appliedVersions.push(Number(row.items[0].uint64Value));
          }
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get applied migrations:', error);
    // Если таблица миграций еще не существует, это нормально на первом запуске
    if (!(error instanceof Error && error.message.includes('Cannot find table')) && !(error instanceof Error && error.message.includes('SchemeError'))) {
        throw error;
    }
  }
  return appliedVersions;
}

async function addMigrationRecord(driver: Driver, version: number, name: string): Promise<void> {
  await driver.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $version AS Uint64;
      DECLARE $migration AS Utf8;
      DECLARE $timestamp AS Timestamp;

      UPSERT INTO migrations (version, migration, timestamp)
      VALUES ($version, $migration, $timestamp);
    `;
    const now = new Date();
    const timestampMicroseconds = now.getTime() * 1000;

    await session.executeQuery(query, {
      $version: { type: Types.UINT64, value: { uint64Value: version } },
      $migration: { type: Types.UTF8, value: { textValue: name } },
      $timestamp: { type: Types.TIMESTAMP, value: { uint64Value: timestampMicroseconds } },
    });
    logger.info(`Migration ${version} - ${name} recorded.`);
  });
}

async function applyMigrations(iamToken?: string): Promise<void> {
  const driver = await getDriver(iamToken);
  const appliedVersions = await getAppliedMigrations(driver);
  logger.info(`Applied migration versions: ${appliedVersions.join(', ')}`);

  for (const migration of migrations) {
    if (!appliedVersions.includes(migration.version)) {
      logger.info(`Applying migration ${migration.version}: ${migration.name}...`);
      try {
        await migration.up(driver);
        await addMigrationRecord(driver, migration.version, migration.name);
        logger.info(`Migration ${migration.version}: ${migration.name} applied successfully.`);
      } catch (error) {
        logger.error(`Failed to apply migration ${migration.version}: ${migration.name}:`, error);
        throw error; // Останавливаем процесс, если миграция не удалась
      }
    }
  }
}

export async function setupDatabase() {
  try {
    console.log('Starting database setup...');
    await ensureChatsTableExists();
    await ensurePromptsTableExists();
    await ensureMigrationsTableExists();
	await ensureUsersTableExists();
    await applyMigrations(); // Добавляем вызов функции применения миграций
    console.log('Database setup completed successfully.');
  } catch (error) {
    console.error('Failed to setup database:', error);
    process.exit(1); // Выход с ошибкой, если настройка не удалась
  } finally {
    await closeDriver(); // Убедитесь, что функция closeDriver экспортируется из ydb.ts и корректно закрывает соединение
    console.log('Database connection closed.');
  }
}