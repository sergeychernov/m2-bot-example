import { Driver, Logger, QuerySession } from 'ydb-sdk'; 

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
];