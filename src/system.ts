import { Driver, Types } from 'ydb-sdk';
import { getDriver, logger } from './ydb';

type SystemValue = string | number | boolean;
type Parser = 'parseInt' | 'parseFloat' | 'boolean' | undefined;

interface SystemRow {
    name: string;
    value: string;
    parser?: Parser;
}

class System {
    private static instance: System | null = null;
    private static initPromise: Promise<System> | null = null;
    private values: Map<string, SystemValue> = new Map();
    private parsers: Map<string, Parser> = new Map();

    private constructor() {}

    private parseValue(value: string, parser?: Parser): SystemValue {
        switch (parser) {
            case 'parseInt':
                return parseInt(value, 10);
            case 'parseFloat':
                return parseFloat(value);
            case 'boolean':
                return Boolean(value === 'true');
            default:
                return value;
        }
    }

    private async setValue(name: string, value: SystemValue, parser?: Parser): Promise<void> {
        const driver = await getDriver();
        const stringValue = String(value);

        try {
            await driver.tableClient.withSession(async (session) => {
                const query = `
                    DECLARE $name AS Utf8;
                    DECLARE $value AS Utf8;
                    DECLARE $parser AS Utf8;

                    UPSERT INTO system (name, value, parser)
                    VALUES ($name, $value, $parser);
                `;

                await session.executeQuery(query, {
                    $name: { type: Types.UTF8, value: { textValue: name } },
                    $value: { type: Types.UTF8, value: { textValue: stringValue } },
                    $parser: { type: Types.UTF8, value: parser ? { textValue: parser } : null },
                });
            });

            this.values.set(name, this.parseValue(stringValue, parser));
            if (parser) this.parsers.set(name, parser);

            logger.info(`System value ${name} updated successfully`);
        } catch (error) {
            logger.error('Failed to update system value:', error);
            throw error;
        }
    }

    private async loadValues(driver: Driver): Promise<void> {
        try {
            await driver.tableClient.withSession(async (session) => {
                const query = 'SELECT name, value, parser FROM system;';
                const { resultSets } = await session.executeQuery(query);

                if (resultSets[0]?.rows) {
                    for (const row of resultSets[0].rows) {
                        const name = row.items?.[0]?.textValue;
                        const value = row.items?.[1]?.textValue;
                        const parser = row.items?.[2]?.textValue as Parser;

                        if (name && value) {
                            this.values.set(name, this.parseValue(value, parser));
                            if (parser) this.parsers.set(name, parser);
                        }
                    }
                }
            });
        } catch (error) {
            logger.error('Failed to load system values:', error);
            throw error;
        }
    }

    public static async getInstance(): Promise<System> {
        if (System.instance) {
            return System.instance;
        }

        if (System.initPromise) {
            return System.initPromise;
        }

        System.initPromise = (async () => {
            const instance = new System();
            const driver = await getDriver();
            await instance.loadValues(driver);
            System.instance = instance;
            System.initPromise = null;
            return instance;
        })();

        return System.initPromise;
    }

    public get version(): number | undefined {
        return this.values.get('version') as number | undefined;
    }

    public async setVersion(value: number): Promise<void> {
        await this.setValue('version', value, 'parseInt');
    }
}

export async function getSystem(): Promise<System> {
    return System.getInstance();
}