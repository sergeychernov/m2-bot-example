import { Driver, Logger, QuerySession, Types } from 'ydb-sdk'; 
export interface Migration {
    version: number;
    name: string;
    up: (driver: Driver, logger: Logger) => Promise<void>;
}

export const migrations: Migration[] = [
    {
        version: 1,
        name: 'InitialMigration',
        async up(driver: Driver, logger: Logger) {
            logger.info('Applying initial migration (noop)');
            // No operation for the initial version, tables are created by ensureTablesExist
        },
    },
    {
        version: 2,
        name: 'AddRealtorIdToChatsTable',
        async up(driver: Driver, logger: Logger) {
            logger.info(`Applying migration: AddRealtorIdToChatsTable`);
            try {
                await driver.queryClient.do({
                    fn: async (session: QuerySession) => { 
                        const query = `
                            ALTER TABLE chats
                            ADD COLUMN realtorId Utf8;
                        `;
                        logger.info('Executing query:\n' + query);
                        await session.execute({ text: query }); // Wrap query in an object { text: query }
                        logger.info('Migration AddRealtorIdToChatsTable applied successfully');
                    }
                });
            } catch (error) {
                // It's okay if the column already exists, but log other errors
                if (error instanceof Error) {
                    if (error.message.includes('already exists') || error.message.includes('Cannot add column to table')) {
                        logger.warn(`Could not add column realtorId, it might already exist or there's another schema issue: ${error.message}`);
                    } else {
                        logger.error('Failed to apply migration AddRealtorIdToChatsTable:', error);
                        throw error; // Re-throw to stop further processing if it's a critical error
                    }
                } else {
                    // Handle non-Error objects thrown
                    logger.error('Failed to apply migration AddRealtorIdToChatsTable with a non-Error object:', error);
                    throw error;
                }
            }
        },
    },
    {
        version: 3, 
        name: 'AddGptSettingsToPromptsTableAndUpdateExistingRows',
        async up(driver: Driver, logger: Logger) {
            logger.info(`Applying migration: AddGptSettingsToPromptsTableAndUpdateExistingRows`);

            // Шаг 1: Добавление колонок
            try {
                await driver.queryClient.do({
                    fn: async (session: QuerySession) => { 
                        const alterQueries = [
                            'ALTER TABLE prompts ADD COLUMN model Utf8;',
                            'ALTER TABLE prompts ADD COLUMN `stream` Bool;', // Quoted 'stream'
                            'ALTER TABLE prompts ADD COLUMN temperature Double;',
                            'ALTER TABLE prompts ADD COLUMN maxTokens Int64;'
                        ];
                        
                        for (const query of alterQueries) {
                            logger.info('Executing DDL query: ' + query);
                            await session.execute({ text: query });
                        }
                        logger.info('Columns added to prompts table successfully');
                    }
                });
            } catch (error) {
                if (error instanceof Error && error.message.includes('already exists')) {
                    logger.warn(`Could not add columns to prompts table, they might already exist: ${error.message}`);
                } else {
                    logger.error('Failed to add columns to prompts table:', JSON.stringify(error));
                    throw error;
                }
            }

            // Шаг 2: Обновление существующих записей
            try {
                const gptConfig = {
                    "model": "/yandexgpt-lite/latest",
                    "completionOptions": {
                      "stream": false,
                      "temperature": 0.6,
                      "maxTokens": 20000
                    }
                  };

                await driver.queryClient.do({
                    fn: async (session: QuerySession) => {
                        const updateQuery = `
                            DECLARE $model AS Utf8;
                            DECLARE $stream AS Bool;
                            DECLARE $temperature AS Double;
                            DECLARE $maxTokens AS Int64;

                            UPDATE prompts
                            SET model = $model, stream = $stream, temperature = $temperature, maxTokens = $maxTokens;
                        `;
                        
                        logger.info('Executing update query for existing rows in prompts table');
                        // Используем синтаксис параметров с Types, как в ydb.ts
                        await session.execute({
                            text: updateQuery,
                            parameters: {
                                $model: { type: Types.UTF8, value: { textValue: gptConfig.model } },
                                $stream: { type: Types.BOOL, value: { boolValue: gptConfig.completionOptions.stream } },
                                $temperature: { type: Types.DOUBLE, value: { doubleValue: gptConfig.completionOptions.temperature } },
                                $maxTokens: { type: Types.INT64, value: { int64Value: gptConfig.completionOptions.maxTokens } },
                            }
                        });
                        logger.info('Existing rows in prompts table updated successfully with default GPT settings.');
                    }
                });
            } catch (error) {
                logger.error('Failed to update existing rows in prompts table:', JSON.stringify(error));
                // throw error; 
            }
        },
    },
    {
        version: 4,
        name: 'UpdateUsersTableWithUserIdAndMode',
        async up(driver: Driver, logger: Logger) {
            logger.info(`Applying migration: UpdateUsersTableWithUserIdAndMode`);

            await driver.queryClient.do({ fn: async (session: QuerySession) => {
                logger.info('Dropping temporary users_new table if it exists...');
                await session.execute({ text: 'DROP TABLE IF EXISTS users_new;' });

                logger.info('Creating temporary users_new table...');
                await session.execute({ text: `
                    CREATE TABLE users_new (
                        userId Utf8,
                        profile Json,
                        mode Utf8,
                        PRIMARY KEY (userId)
                    );
                `});

                logger.info('Copying data from users to users_new...');
                await session.execute({ text: `
                    UPSERT INTO users_new (userId, profile, mode)
                    SELECT botClientId AS userId, profile, CAST('none' AS Utf8) AS mode FROM users;
                `});

                logger.info('Dropping old users table...');
                await session.execute({ text: 'DROP TABLE users;' });

                logger.info('Renaming users_new to users...');
                await session.execute({ text: 'ALTER TABLE users_new RENAME TO users;' });

                logger.info('Migration UpdateUsersTableWithUserIdAndMode applied successfully');
            }}).catch(async (error) => {
                logger.error('Failed to apply migration UpdateUsersTableWithUserIdAndMode:', JSON.stringify(error));
                // Попытка очистки в случае ошибки
                try {
                    await driver.queryClient.do({ fn: async (session: QuerySession) => {
                        logger.info('Attempting to clean up by dropping users_new table...');
                        await session.execute({ text: 'DROP TABLE IF EXISTS users_new;' });
                    }});
                } catch (cleanupError) {
                    logger.error('Failed to cleanup users_new table after migration failure:', JSON.stringify(cleanupError));
                }
                throw error;
            });
        },
    },
    {
        version: 5,
        name: 'MakeProfileAndModeOptionalInUsers',
        async up(driver: Driver, logger: Logger) {
            logger.info(`Applying migration: MakeProfileAndModeOptionalInUsers`);

            await driver.queryClient.do({ fn: async (session: QuerySession) => {
                logger.info('Dropping temporary users_new_optional table if it exists...');
                await session.execute({ text: 'DROP TABLE IF EXISTS users_new_optional;' });

                logger.info('Creating temporary users_new_optional table with optional profile and mode...');
                await session.execute({ text: `
                    CREATE TABLE users_new_optional (
                        userId Utf8,
                        profile Optional<Json>,
                        mode Optional<Utf8>,
                        PRIMARY KEY (userId)
                    );
                `});

                logger.info('Copying data from users to users_new_optional...');
                await session.execute({ text: `
                    UPSERT INTO users_new_optional (userId, profile, mode)
                    SELECT userId, profile, mode FROM users;
                `});

                logger.info('Dropping old users table...');
                await session.execute({ text: 'DROP TABLE users;' });

                logger.info('Renaming users_new_optional to users...');
                await session.execute({ text: 'ALTER TABLE users_new_optional RENAME TO users;' });

                logger.info('Migration MakeProfileAndModeOptionalInUsers applied successfully');
            }}).catch(async (error) => {
                logger.error('Failed to apply migration MakeProfileAndModeOptionalInUsers:', JSON.stringify(error));
                try {
                    await driver.queryClient.do({ fn: async (session: QuerySession) => {
                        logger.info('Attempting to clean up by dropping users_new_optional table...');
                        await session.execute({ text: 'DROP TABLE IF EXISTS users_new_optional;' });
                    }});
                } catch (cleanupError) {
                    logger.error('Failed to cleanup users_new_optional table after migration failure:', JSON.stringify(cleanupError));
                }
                throw error;
            });
        },
    },
    {
        version: 6,
        name: 'AddUserIdAndChangeChatIdToChatsTable',
        async up(driver: Driver, logger: Logger) {
            logger.info(`Applying migration: AddUserIdAndChangeChatIdToChatsTable`);

            await driver.queryClient.do({ fn: async (session: QuerySession) => {
                logger.info('Dropping temporary chats_new table if it exists...');
                await session.execute({ text: 'DROP TABLE IF EXISTS chats_new;' });

                logger.info('Creating temporary chats_new table...');
                await session.execute({ text: `
                    CREATE TABLE chats_new (
                        chatId Int64,
                        messageId Utf8,
                        userId Int64,
                        message Utf8,
                        timestamp Timestamp,
                        type Utf8,
                        realtorId Utf8,
                        PRIMARY KEY (chatId, messageId, userId)
                    );
                `});

                logger.info('Copying data from chats to chats_new...');
                await session.execute({ text: `
                    UPSERT INTO chats_new (chatId, messageId, userId, message, timestamp, type, realtorId)
                    SELECT CAST(chatId AS Int64), messageId, 0 AS userId, message, timestamp, type, realtorId FROM chats;
                `});

                logger.info('Dropping old chats table...');
                await session.execute({ text: 'DROP TABLE chats;' });

                logger.info('Renaming chats_new to chats...');
                await session.execute({ text: 'ALTER TABLE chats_new RENAME TO chats;' });

                logger.info('Migration AddUserIdAndChangeChatIdToChatsTable applied successfully');
            }}).catch(async (error) => {
                logger.error('Failed to apply migration AddUserIdAndChangeChatIdToChatsTable:', JSON.stringify(error));
                try {
                    await driver.queryClient.do({ fn: async (session: QuerySession) => {
                        logger.info('Attempting to clean up by dropping chats_new table...');
                        await session.execute({ text: 'DROP TABLE IF EXISTS chats_new;' });
                    }});
                } catch (cleanupError) {
                    logger.error('Failed to cleanup chats_new table after migration failure:', JSON.stringify(cleanupError));
                }
                throw error;
            });
        },
    },
    {
        version: 7,
        name: 'RemoveRealtorIdFromChatsTable',
        async up(driver: Driver, logger: Logger) {
            logger.info(`Applying migration: RemoveRealtorIdFromChatsTable`);
            try {
                await driver.queryClient.do({
                    fn: async (session: QuerySession) => { 
                        const query = `
                            ALTER TABLE chats
                            DROP COLUMN realtorId;
                        `;
                        logger.info('Executing query:\n' + query);
                        await session.execute({ text: query });
                        logger.info('Migration RemoveRealtorIdFromChatsTable applied successfully');
                    }
                });
            } catch (error) {
                if (error instanceof Error) {
                    if (error.message.includes('Column not found') || error.message.includes('does not exist')) {
                        logger.warn(`Could not drop column realtorId, it might not exist: ${error.message}`);
                    } else {
                        logger.error('Failed to apply migration RemoveRealtorIdFromChatsTable:', error);
                        throw error;
                    }
                } else {
                    logger.error('Failed to apply migration RemoveRealtorIdFromChatsTable with a non-Error object:', error);
                    throw error;
                }
            }
        },
    }
];