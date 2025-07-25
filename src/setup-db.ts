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
			  .withColumn(new Column('chatId', Types.INT64))
			  .withColumn(new Column('messageId', Types.INT64))
			  .withColumn(new Column('business_connection_id', Types.UTF8))
			  .withColumn(new Column('message', Types.UTF8))
			  .withColumn(new Column('timestamp', Types.TIMESTAMP))
			  .withColumn(new Column('who', Types.JSON))
			  .withColumn(new Column('answered', Types.JSON))
			  .withColumn(new Column('replied_message', Types.UTF8))
			  .withPrimaryKeys('chatId', 'messageId', 'business_connection_id')
		  );
		  logger.info("Table 'chats' created successfully.");
		}
	  });
	} catch (error) {
	  logger.error('Failed to ensure chats table exists:', error);
	  throw error;
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
			  .withColumn(new Column('greetingPrompt', Types.UTF8))
			  .withColumn(new Column('dialogPrompt', Types.UTF8))
			  .withColumn(new Column('promptType', Types.UTF8))
			  .withColumn(new Column('createdAt', Types.TIMESTAMP))
			  .withColumn(new Column('model', Types.UTF8))
			  .withColumn(new Column('stream', Types.BOOL))
			  .withColumn(new Column('temperature', Types.DOUBLE))
			  .withColumn(new Column('maxTokens', Types.INT64))
			  .withColumn(new Column('pauseBotTime', Types.INT64))
			  .withPrimaryKeys('promptId')
		  );
		  logger.info("Table 'prompts' created successfully.");

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
			  10,
			  iamToken,
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

async function ensureClientsTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
		await currentDriver.tableClient.withSession(async (session) => {
			try {
				await session.describeTable('clients');
				logger.info("Table 'clients' already exists.");
			} catch (error: any) {
				logger.info("Table 'clients' not found, creating...");
				await session.createTable(
					'clients',
					new TableDescription()
						.withColumn(new Column('id', Types.INT64))
						.withColumn(new Column('first_name', Types.optional(Types.UTF8)))
						.withColumn(new Column('last_name', Types.optional(Types.UTF8)))
						.withColumn(new Column('username', Types.optional(Types.UTF8)))
						.withColumn(new Column('language_code', Types.optional(Types.UTF8)))
						.withColumn(new Column('quickMode', Types.BOOL))
						.withColumn(new Column('mute', Types.JSON))
						.withPrimaryKeys('id')
				);
				logger.info("Table 'clients' created successfully.");
			}
		});
	} catch (error) {
		logger.error('Failed to ensure clients table exists:', error);
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
						.withColumn(new Column('userId', Types.INT64))
						.withColumn(new Column('profile', Types.optional(Types.JSON)))
						.withColumn(new Column('first_name', Types.optional(Types.UTF8)))
						.withColumn(new Column('last_name', Types.optional(Types.UTF8)))
						.withColumn(new Column('username', Types.optional(Types.UTF8)))
						.withColumn(new Column('language_code', Types.optional(Types.UTF8)))
                        .withColumn(new Column('mode', Types.optional(Types.UTF8)))
						.withColumn(new Column('business_connection_id', Types.optional(Types.UTF8)))
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

async function ensureQuizStatesTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
		await currentDriver.tableClient.withSession(async (session) => {
			try {
				await session.describeTable('quiz_states');
				logger.info("Table 'quiz_states' already exists.");
			} catch (error: any) {
				logger.info("Table 'quiz_states' not found, creating...");
				await session.createTable(
					'quiz_states',
					new TableDescription()
						.withColumn(new Column('userId', Types.INT64))
						.withColumn(new Column('step', Types.INT32))
						.withColumn(new Column('answers', Types.JSON))
						.withColumn(new Column('allowExit', Types.BOOL))
						.withPrimaryKeys('userId')
				);
				logger.info("Table 'quiz_states' created successfully.");
			}
		});
	} catch (error) {
		logger.error('Failed to ensure quiz_states table exists:', error);
		throw error;
	}
}

async function ensureQuizConfigsTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
		await currentDriver.tableClient.withSession(async (session) => {
			try {
				await session.describeTable('quiz_configs');
				logger.info("Table 'quiz_configs' already exists.");
			} catch (error: any) {
				logger.info("Table 'quiz_configs' not found, creating...");
				await session.createTable(
					'quiz_configs',
					new TableDescription()
						.withColumn(new Column('id', Types.UTF8))
						.withColumn(new Column('quizConfig', Types.JSON))
						.withColumn(new Column('createdAt', Types.TIMESTAMP))
						.withPrimaryKeys('id')
				);
				logger.info("Table 'quiz_configs' created successfully.");
			}
		});
	} catch (error) {
		logger.error('Failed to ensure quiz_states table exists:', error);
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
			  .withColumn(new Column('version', Types.UINT64))
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

    const system = await getSystem();
    const currentVersion = system.version || 0;

    const pendingMigrations = migrations
        .filter(m => m.version > currentVersion)
        .sort((a, b) => a.version - b.version);

    for (const migration of pendingMigrations) {
        if (!appliedVersions.has(migration.version)) {
            try {
                logger.info(`Applying migration ${migration.version}: ${migration.name}`);
                await migration.up(driver, logger);
                await addMigrationRecord(driver, migration.version, migration.name);

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

async function ensureBudgetTableExists(iamToken?: string): Promise<void> {
	const currentDriver = await getDriver(iamToken);
	try {
		await currentDriver.tableClient.withSession(async (session) => {
			try {
				await session.describeTable('budget');
				logger.info("Table 'budget' already exists.");
			} catch (error: any) {
				logger.info("Table 'budget' not found, creating...");
				await session.createTable(
					'budget',
					new TableDescription()
						.withColumn(new Column('chatId', Types.INT64))
						.withColumn(new Column('business_connection_id', Types.UTF8))
						.withColumn(new Column('inputTextTokens', Types.INT64))
						.withColumn(new Column('completionTokens', Types.INT64))
						.withColumn(new Column('totalTokens', Types.INT64))
						.withColumn(new Column('alternatives', Types.INT64))
						.withColumn(new Column('messages', Types.INT64))
						.withColumn(new Column('promptType', Types.UTF8))
						.withColumn(new Column('timestamp', Types.TIMESTAMP))
						.withPrimaryKeys('chatId', 'business_connection_id','promptType', 'timestamp')
				);
				logger.info("Table 'budget' created successfully.");
			}
		});
	} catch (error) {
		logger.error('Failed to ensure budget table exists:', JSON.stringify(error));
		throw error;
	}
}

export async function setupDatabase() {
  try {
    console.log('Starting database setup...');
    await ensureSystemTableExists();
    await ensureChatsTableExists();
    await ensurePromptsTableExists();
    await ensureUsersTableExists();
	await ensureClientsTableExists();
	await ensureQuizStatesTableExists();
	await ensureQuizConfigsTableExists();
	await ensureBudgetTableExists();
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