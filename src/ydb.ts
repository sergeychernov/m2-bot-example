import {
    Driver, 
    Logger, 

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
  const authService = iamToken ? new TokenAuthService(iamToken) : new MetadataAuthService();
 const driver = new Driver({
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
export async function closeDriver() {
  if (driver) {
    await driver.destroy();
    driver = undefined;
    logger.info('Driver destroyed');
  }
}
