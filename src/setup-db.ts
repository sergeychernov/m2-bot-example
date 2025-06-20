import { Column, Driver, TableDescription, Types } from 'ydb-sdk';
import { closeDriver, getDriver, logger, addPrompt } from './ydb';
import fs from 'fs';
import path from 'path';
import { migrations } from './migrations';
import { getSystem } from './system';

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
			  .withColumn(new Column('type', Types.UTF8))
			  .withColumn(new Column('realtorId', Types.UTF8)) // Добавлено новое поле realtorId
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
			  .withColumn(new Column('model', Types.UTF8)) // Новое поле
			  .withColumn(new Column('stream', Types.BOOL)) // Новое поле
			  .withColumn(new Column('temperature', Types.DOUBLE)) // Новое поле
			  .withColumn(new Column('maxTokens', Types.INT64)) // Новое поле
			  .withPrimaryKeys('promptId')
		  );
		  logger.info("Table 'prompts' created successfully.");
  
		  // Добавляем базовый промпт из файла после создания таблицы
		  try {
			const promptFilePath = path.resolve(__dirname, 'system_prompt.md');
			const initialPromptText = fs.readFileSync(promptFilePath, 'utf-8');
			const gptConfigPath = path.resolve(__dirname, 'gpt.json');
			const gptConfigFile = fs.readFileSync(gptConfigPath, 'utf-8');
			const gptConfig = JSON.parse(gptConfigFile);

			await addPrompt(
			  initialPromptText, 
			  'base', 
			  gptConfig.model, 
			  gptConfig.completionOptions.stream, 
			  gptConfig.completionOptions.temperature, 
			  gptConfig.completionOptions.maxTokens, 
			  iamToken
			); 
			logger.info('Initial base prompt added to DB from system_prompt.md and gpt.json after table creation.');
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
						.withColumn(new Column('botClientId', Types.UTF8))
						.withColumn(new Column('profile', Types.JSON))
				);
				logger.info("Table 'users' created successfully.");
			}
		});
	} catch (error) {
		logger.error('Failed to ensure users table exists:', error);
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

async function getAppliedMigrations(driver: Driver): Promise<Set<number>> {
    const query = `SELECT version FROM \`migrations\`;`;
    let appliedVersions: number[] = [];

    logger.info('Fetching applied migrations...');

    await driver.tableClient.withSession(async (session) => {
        const { resultSets } = await session.executeQuery(query);
        if (resultSets[0]?.rows) {
            appliedVersions = resultSets[0].rows.map(row => {
                // Assuming 'version' is stored as UINT64, it might come back as a string or a number depending on the driver/SDK version.
                // Ensure it's parsed to a number if it's not already.
                const versionValue = row.items![0].uint64Value;
                return typeof versionValue === 'string' ? parseInt(versionValue, 10) : Number(versionValue);
            });
        }
    });

    logger.info(`Found applied migrations: ${appliedVersions.join(', ')}`);
    return new Set(appliedVersions);
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
    logger.info('Applying migrations...');
    const appliedVersions = await getAppliedMigrations(driver);

    // Получаем текущую версию из system
    const system = await getSystem();
    const currentVersion = system.version || 0;

    // Сортируем миграции по версии и фильтруем только те, что больше текущей
    const pendingMigrations = migrations
        .filter(m => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);

    for (const migration of pendingMigrations) {
        if (!appliedVersions.has(migration.version)) {
            try {
                logger.info(`Applying migration ${migration.version}: ${migration.name}`);
                await migration.up(driver, logger);
                await addMigrationRecord(driver, migration.version, migration.name);

                // Обновляем версию в system после успешного применения миграции
                await system.setVersion(migration.version);

                logger.info(`Migration ${migration.version}: ${migration.name} applied successfully.`);
            } catch (error) {
                logger.error(`Failed to apply migration ${migration.version}: ${migration.name}`, JSON.stringify(error));
                throw error;
            }
        } else {
            logger.info(`Migration ${migration.version}: ${migration.name} already applied.`);
        }
    }
    logger.info('All migrations applied.');
}

async function ensureSystemTableExists(iamToken?: string): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      try {
        await session.describeTable('system');
        logger.info("Table 'system' already exists.");
      } catch (error: any) {
        logger.info("Table 'system' not found, creating...");
        await session.createTable(
          'system',
          new TableDescription()
            .withColumn(new Column('name', Types.UTF8))
            .withColumn(new Column('value', Types.UTF8))
            .withColumn(new Column('parser', Types.UTF8))
            .withPrimaryKeys('name')
        );
        logger.info("Table 'system' created successfully.");

        // Вычисляем максимальную версию из массива миграций
        const maxVersion = Math.max(...migrations.map(m => m.version));

        const query = `
          DECLARE $name AS Utf8;
          DECLARE $value AS Utf8;
          DECLARE $parser AS Utf8;

          UPSERT INTO system (name, value, parser)
          VALUES ($name, $value, $parser);
        `;

        await session.executeQuery(query, {
          $name: { type: Types.UTF8, value: { textValue: 'version' } },
          $value: { type: Types.UTF8, value: { textValue: maxVersion.toString() } },
          $parser: { type: Types.UTF8, value: { textValue: 'parseInt' } }
        });
        logger.info("Added version record to system table.");
      }
    });
  } catch (error) {
    logger.error('Failed to ensure system table exists:', error);
    throw error;
  }
}

export async function setupDatabase() {
  try {
    console.log('Starting database setup...');
    await ensureSystemTableExists(); // Создаем первой
    await ensureChatsTableExists();
    await ensurePromptsTableExists();
    await ensureUsersTableExists();
    await ensureMigrationsTableExists();
    await applyMigrations();
    console.log('Database setup completed successfully.');
  } catch (error) {
    console.error('Failed to setup database:', JSON.stringify(error));
    process.exit(1);
  } finally {
    await closeDriver();
    console.log('Database connection closed.');
  }
}