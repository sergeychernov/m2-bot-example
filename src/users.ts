import {ChatMessage, getDriver} from './ydb';
import { Types } from 'ydb-sdk';
import { User } from 'grammy/types';

export async function addUserData(
    user: User,
    profile: Record<string, any> = {},
    mode: string = 'none',
    iamToken?: string
): Promise<void> {
  const currentDriver = await getDriver(iamToken);
  try {
    await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $userId AS Int64;
        DECLARE $profile AS Json;
        DECLARE $mode AS Utf8;
        DECLARE $first_name AS Utf8?;
        DECLARE $last_name AS Utf8?;
        DECLARE $username AS Utf8?;
        DECLARE $language_code AS Utf8?;
        UPSERT INTO users (userId, profile, mode, first_name, last_name, username, language_code)
        VALUES ($userId, $profile, $mode, $first_name, $last_name, $username, $language_code);
      `;
      await session.executeQuery(query, {
        $userId: { type: Types.INT64, value: { int64Value: user.id } },
        $profile: { type: Types.JSON, value: { textValue: JSON.stringify(profile) } },
        $mode: { type: Types.UTF8, value: { textValue: mode } },
        $first_name: { type: Types.optional(Types.UTF8), value: { textValue: user.first_name ?? '' } },
        $last_name: { type: Types.optional(Types.UTF8), value: { textValue: user.last_name ?? '' } },
        $username: { type: Types.optional(Types.UTF8), value: { textValue: user.username ?? '' } },
        $language_code: { type: Types.optional(Types.UTF8), value: { textValue: user.language_code ?? '' } },
      });
      console.info(`User data for ${user.id} added/updated in 'users' table.`);
    });
  } catch (error) {
    console.error('Failed to add user data:', JSON.stringify(error));
    throw error;
  }
}

// Версия для поиска по userId
export async function getUserDataByUserId(userId: number, iamToken?: string): Promise<{ profile: Record<string, any>, mode: string } | null> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $userId AS Int64;
        SELECT profile, mode FROM users WHERE userId = $userId LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $userId: { type: Types.INT64, value: { int64Value: userId } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        const profile = JSON.parse(row.items![0].textValue || '{}');
        const mode = row.items![1].textValue || 'none';
        return { profile, mode };
      }
      return null;
    });
  } catch (error) {
    console.error('Failed to get user data by userId:', JSON.stringify(error));
    throw error;
  }
}

// Версия для поиска по businessConnectionId
export async function getUserDataByBusinessConnectionId(businessConnectionId: string, iamToken?: string): Promise<{ profile: Record<string, any>, mode: string } | null> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $businessConnectionId AS Utf8;
        SELECT profile, mode FROM users WHERE business_connection_id = $businessConnectionId LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $businessConnectionId: { type: Types.UTF8, value: { textValue: businessConnectionId } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        const profile = JSON.parse(row.items![0].textValue || '{}');
        const mode = row.items![1].textValue || 'none';
        return { profile, mode };
      }
      return null;
    });
  } catch (error) {
    console.error('Failed to get user data by businessConnectionId:', JSON.stringify(error));
    throw error;
  }
}

export async function getUserIdByBusinessConnectionId(businessConnectionId: string, iamToken?: string): Promise<number | null> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $businessConnectionId AS Utf8;
        SELECT userId FROM users WHERE business_connection_id = $businessConnectionId LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $businessConnectionId: { type: Types.UTF8, value: { textValue: businessConnectionId } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        return Number(row.items![0].int64Value);
      }
      return null;
    });
  } catch (error) {
    console.error('Failed to get userId by businessConnectionId:', JSON.stringify(error));
    throw error;
  }
}

export async function getBusinessConnectionIdByUserId(userId: number, iamToken?: string): Promise<string | null> {
  const currentDriver = await getDriver(iamToken);
  try {
    return await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $userId AS Int64;
        SELECT business_connection_id FROM users WHERE userId = $userId LIMIT 1;
      `;
      const { resultSets } = await session.executeQuery(query, {
        $userId: { type: Types.INT64, value: { int64Value: userId } },
      });
      if (resultSets[0]?.rows && resultSets[0].rows.length > 0) {
        const row = resultSets[0].rows[0];
        return row.items![0].textValue || null;
      }
      return null;
    });
  } catch (error) {
    console.error('Failed to get businessConnectionId by userId:', JSON.stringify(error));
    throw error;
  }
}

export async function isUserOnline(
    timeoutMinutes: number = 10,
    messages: ChatMessage[]
): Promise<boolean> {
  const onlineTimeoutMs = timeoutMinutes * 60 * 1000;
  const userMessages = messages.filter(
      m => m.who.role === 'user' && !m.who.isBot
  );

  if (userMessages.length === 0) {
    return false;
  }

  const lastUserMessage = userMessages.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  )[0];

  return Date.now() - lastUserMessage.timestamp.getTime() < onlineTimeoutMs;
}