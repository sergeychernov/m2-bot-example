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
];