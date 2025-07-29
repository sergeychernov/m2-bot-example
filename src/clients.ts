import {
    Driver,
    Logger,
    Types,
    TokenAuthService,
    MetadataAuthService,

} from 'ydb-sdk';
import { User } from "grammy/types";
import { Mute } from './telegram-utils';

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

export interface Client extends User {
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
                        first_name: row.items[1].textValue ?? '',
                        last_name: row.items[2].textValue ?? undefined,
                        username: row.items[3].textValue ?? undefined,
                        language_code: row.items[4].textValue ?? undefined,
                        quickMode: typeof row.items[5]?.boolValue === 'boolean' ? row.items[5].boolValue : false,
                        mute: JSON.parse(row.items![6].textValue!),
                        is_bot: false
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

export async function getAllClients(iamToken?: string): Promise<Client[]> {
    const currentDriver = await getDriver(iamToken);
    try {
        return await currentDriver.tableClient.withSession(async (session) => {
            const query = `
        SELECT id, first_name, last_name, username, language_code, quickMode, mute FROM clients;
      `;
            const { resultSets } = await session.executeQuery(query);

            const clients: Client[] = [];
            if (resultSets[0]?.rows) {
                for (const row of resultSets[0].rows) {
                    if (row.items) {
                        const client: Client = {
                            id: Number(row.items[0].int64Value),
                            first_name: row.items[1].textValue ?? '',
                            last_name: row.items[2].textValue ?? undefined,
                            username: row.items[3].textValue ?? undefined,
                            language_code: row.items[4].textValue ?? undefined,
                            quickMode: typeof row.items[5]?.boolValue === 'boolean' ? row.items[5].boolValue : false,
                            mute: JSON.parse(row.items![6].textValue!),
                            is_bot: false
                        };
                        clients.push(client);
                    }
                }
            }

            logger.info(`Retrieved ${clients.length} clients from database`);
            return clients;
        });
    } catch (error) {
        logger.error('Failed to get all clients:', error);
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
        DECLARE $mute AS Json?;
        UPSERT INTO clients (id, first_name, last_name, username, language_code, quickMode, mute)
        VALUES ($id, $first_name, $last_name, $username, $language_code, $quickMode, $mute);
      `;

            await session.executeQuery(query, {
                $id: { type: Types.INT64, value: { int64Value: client.id } },
                $first_name: { type: Types.optional(Types.UTF8), value: client.first_name ? { textValue: client.first_name } : { nullFlagValue: 0 } },
                $last_name: { type: Types.optional(Types.UTF8), value: client.last_name ? { textValue: client.last_name } : { nullFlagValue: 0 } },
                $username: { type: Types.optional(Types.UTF8), value: client.username ? { textValue: client.username } : { nullFlagValue: 0 } },
                $language_code: { type: Types.optional(Types.UTF8), value: client.language_code ? { textValue: client.language_code } : { nullFlagValue: 0 } },
                $quickMode: { type: Types.optional(Types.BOOL), value: { boolValue: client.quickMode } },
                $mute: { type: Types.optional(Types.JSON), value: { textValue: JSON.stringify(client.mute) } },

            });
            clientCache.set(client.id, client);
            logger.info(`Client data for ${client.id} added/updated in 'clients' table.`);
        });
    } catch (error) {
        logger.error('Failed to set client data:', JSON.stringify(error));
        throw error;
    }
}

export async function checkAndClearExpiredBotMute(clientId: number): Promise<boolean> {
    const client = await getClient(clientId);

    if (!client?.mute?.status) {
        return false;
    }

    const now = new Date();
    const muteUntil = new Date(client.mute.muteUntil);

    if (muteUntil > now) {
        return true;
    }

    // если мьют устарел, то снимаем его
    try {
        const newClient = {
            ...client,
            mute: {
                status: false,
                muteUntil: ''
            }
        };
        await setClient(newClient);

        console.log(`[MUTE CLEARED] Бот возобновлен для клиента (ID: ${clientId})`);
        
    } catch (e) {
        console.error(`[checkAndClearExpiredBotMute] не удалось автоматически переустановить mute для клиента ${clientId}:`, e);
    }

    return false;
}

export async function checkBotMuteForAllClients () {
    const clients = await getAllClients();
    for (const client of clients) {
        await checkAndClearExpiredBotMute(client.id);
    }
}

