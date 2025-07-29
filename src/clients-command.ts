import { getDriver, getLastChatMessages, getMode, ChatMessage } from './ydb';
import { getBusinessConnectionIdByUserId } from './users';
import { Context, InlineKeyboard } from 'grammy';
import { Types } from 'ydb-sdk';
import { getGPTResponse, loadGptSettingsFromDb, UserMessage } from './gpt';
import { Client, checkAndClearExpiredBotMute, getClient, setClient } from './clients';

/**
 * Получает уникальный список chatId клиентов из таблицы chats по userId
 * @param userId - ID пользователя
 * @returns Массив уникальных chatId
 */
export async function getClientChatIds(userId: number): Promise<number[]> {
  const mode = await getMode(userId);
  if (mode === 'demo') {
    return [userId];
  }
  // Сначала получаем business_connection_id по userId
  const businessConnectionId = await getBusinessConnectionIdByUserId(userId);
  
  if (!businessConnectionId) {
    console.warn(`No business connection found for user ${userId}`);
    return [];
  }
  
  const currentDriver = await getDriver();
  
  try {
    const result = await currentDriver.tableClient.withSession(async (session) => {
      const query = `
        DECLARE $businessConnectionId AS Utf8;
        SELECT DISTINCT chatId
        FROM chats
        WHERE business_connection_id = $businessConnectionId
        ORDER BY chatId;
      `;
      
      const queryResult = await session.executeQuery(query, {
        $businessConnectionId: { type: Types.UTF8, value: { textValue: businessConnectionId } }
      });
      
      const chatIds: number[] = [];
      for (const resultSet of queryResult.resultSets) {
        for (const row of resultSet.rows ?? []) {
          const chatId = row.items?.[0]?.int64Value;
          if (chatId) {
            chatIds.push(Number(chatId));
          }
        }
      }
      
      return chatIds;
    });
    
    console.info(`Found ${result.length} unique chat IDs for user ${userId} (business_connection_id: ${businessConnectionId})`);
    return result;
  } catch (error) {
    console.error('Failed to get client chat IDs:', JSON.stringify(error));
    throw error;
  }
}

/**
 * Получает данные клиентов из таблицы clients по массиву chatId
 * @param chatIds - Массив chatId
 * @returns Массив данных клиентов
 */
export async function getClientsData(chatIds: number[]): Promise<Client[]> {
  if (chatIds.length === 0) {
    return [];
  }

  const currentDriver = await getDriver();
  
  try {
    const result = await currentDriver.tableClient.withSession(async (session) => {
      const placeholders = chatIds.map((_, index) => `$chatId${index}`).join(', ');
      const declarations = chatIds.map((_, index) => `DECLARE $chatId${index} AS Int64;`).join('\n        ');
      
      const query = `
        ${declarations}
        SELECT id, first_name, last_name, username, language_code, quickMode, mute
        FROM clients
        WHERE id IN (${placeholders})
        ORDER BY id;
      `;
      
      const params: any = {};
      chatIds.forEach((chatId, index) => {
        params[`$chatId${index}`] = { type: Types.INT64, value: { int64Value: chatId } };
      });
      
      const queryResult = await session.executeQuery(query, params);
      
      const clients: Client[] = [];
      for (const resultSet of queryResult.resultSets) {
        for (const row of resultSet.rows ?? []) {
          const items = row.items ?? [];
          const client: Client = {
            id: Number(items[0]?.int64Value || 0),
            first_name: items[1]?.textValue || '',
            last_name: items[2]?.textValue || undefined,
            username: items[3]?.textValue || undefined,
            language_code: items[4]?.textValue || undefined,
            quickMode: items[5]?.boolValue || false,
            mute: JSON.parse(row.items![6].textValue!),
            is_bot: false
          };
          clients.push(client);
        }
      }
      
      return clients;
    });
    
    console.info(`Found ${result.length} clients data`);
    return result;
  } catch (error) {
    console.error('Failed to get clients data:', JSON.stringify(error));
    throw error;
  }
}

/**
 * Генерирует отображаемое имя клиента по приоритету:
 * 1. Имя + Фамилия
 * 2. Username
 * 3. ID
 * @param client - Данные клиента
 * @returns Отображаемое имя
 */
export function getClientDisplayName(client: Client): string {
  // Приоритет 1: Имя + Фамилия
  if (client.first_name || client.last_name) {
    const parts = [];
    if (client.first_name) parts.push(client.first_name);
    if (client.last_name) parts.push(client.last_name);
    return parts.join(' ');
  }
  
  // Приоритет 2: Username
  if (client.username) {
    return `@${client.username}`;
  }
  
  // Приоритет 3: ID
  return `ID: ${client.id}`;
}

/**
 * Создает InlineKeyboard с кнопками клиентов
 * @param clients - Массив данных клиентов
 * @returns InlineKeyboard
 */
export function createClientsKeyboard(clients: Client[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  
  if (clients.length === 0) {
    return keyboard.text('Нет клиентов', 'no_clients');
  }

  clients.forEach(client => {
    let displayName = getClientDisplayName(client);

    if (client.mute?.status) {
      displayName += ' ▶️';
    }

    keyboard.text(displayName, `client_${client.id}`).row();
  });
  
  return keyboard;
}

/**
 * Получает полный список клиентов с данными для пользователя
 * @param userId - ID пользователя
 * @returns Массив данных клиентов
 */
export async function getUserClientsWithData(userId: number): Promise<Client[]> {
  const chatIds = await getClientChatIds(userId);
  const clients = await getClientsData(chatIds);
  return clients;
}

/**
 * Инициализирует команду /clients для бота
 * @param bot - Экземпляр бота
 */
export function initializeClientsCommand(bot: any) {
  bot.command('clients', async (ctx: any) => {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('Не удалось определить ваш ID пользователя.');
        return;
      }

      const clients = await getUserClientsWithData(userId);

      if (clients.length === 0) {
        await ctx.reply('У вас пока нет клиентов.');
        return;
      }

      const keyboard = createClientsKeyboard(clients);
      await ctx.reply(`Ваши клиенты (${clients.length}):`, {reply_markup: keyboard});
    } catch (error) {
      console.error('Error in /clients command:', error);
      await ctx.reply('Произошла ошибка при получении списка клиентов.');
    }
  });

  // Обработчик нажатий на кнопки клиентов
  bot.callbackQuery(/client_(.+)/, async (ctx: any) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from?.id;
    if (!userId) {
      console.error('Cannot get user ID from context');
      await ctx.reply('Ошибка: не удалось определить пользователя.');
      return;
    }
    const mode = await getMode(userId);
    const clientId = Number(ctx.match[1]);
    const client = await getClient(clientId);
    if (!client) {
      console.error('Client not found with ID:', clientId);
      await ctx.reply('Клиент не найден.');
      return;
    }
    const businessConnectionId = userId === clientId ? '' : await getBusinessConnectionIdByUserId(userId);
    if (!businessConnectionId && userId != clientId) {
      console.error('Cannot get business connection ID from context');
      await ctx.reply('Ошибка: не удалось определить вашу связь с бизнес-аккаунтом, напишите любое сообщение в @m2assist.');
      return;
    }

    const historyMessages = await getLastChatMessages(clientId, businessConnectionId || '', 50);
    console.log('client_', clientId, userId, businessConnectionId, historyMessages.length);
    // Формируем только сообщения пользователя и ассистента для передачи в getGPTResponse
    const gptMessages: UserMessage[] = historyMessages.map((v: ChatMessage) => {
      if (v.replied_message) {
        return {
          role: v.who.role === 'client' ? 'user' : 'assistant',
          text: `Пользователь ответил на сообщение "${v.message}": ${v.replied_message}`
        }
      }
      return {
        role: v.who.role === 'client' ? 'user' : 'assistant',
        text: v.message
      }
    });

    if (!ctx.from) {
      console.error('Cannot get user ID from context');
      await ctx.reply('Ошибка: не удалось определить пользователя.');
      return;
    }

    const gptResponse = await getGPTResponse(gptMessages, 'summary', businessConnectionId || '', clientId, mode);

    if (gptResponse && gptResponse.text && client && !gptResponse.error) {
      let message = `*Информация о клиенте ${getClientDisplayName(client)}*\n\n` + `${gptResponse.text}`;

      const keyboard = new InlineKeyboard();
      updateKeyboard(client, keyboard);

      const botMuted = await checkAndClearExpiredBotMute(clientId);

      keyboard.row().text(
          botMuted ? '▶️ Возобновить бота' : '⏸️ Приостановить бота',
          `${botMuted ? 'resume' : 'pause'}_bot:${clientId}`
      );

      if (keyboard.inline_keyboard.length > 0) {
        await ctx.reply(message, {parse_mode: 'Markdown', reply_markup: keyboard});
      } else {
        await ctx.reply(message, {parse_mode: 'Markdown'});
      }
    } else {
      console.error('Информация о клиенте не доступна:', JSON.stringify(gptResponse));
      await ctx.reply('Информация о клиенте не доступна.');
    }
  });

  bot.callbackQuery(/^pause_bot:(\d+)$/, async (ctx: Context) => {
    const clientId = Number(ctx?.match?.[1]);
    await handleBotPauseResume(ctx, clientId, true);
  });


  bot.callbackQuery(/^resume_bot:(\d+)$/, async (ctx: Context) => {
    const clientId = Number(ctx?.match?.[1]);
    await handleBotPauseResume(ctx, clientId, false);
  });


  async function handleBotPauseResume(ctx: Context, clientId: number, pause: boolean) {
    await ctx.answerCallbackQuery();

    try {
      const client = await getClient(clientId);
      if (!client) {
        await ctx.answerCallbackQuery('Клиент не найден');
        return;
      }

      const { pauseBotTime = 60 } = (await loadGptSettingsFromDb('base')) || {};
      const muteUntil = pause ? new Date(Date.now() + pauseBotTime * 60_000) : null;

      const updatedClient: Client = {
        ...client,
        mute: {
          status: pause,
          muteUntil: muteUntil?.toISOString() || ''
        },
      }

      try {
        await setClient(updatedClient);
      } catch (err) {
        console.log(`[handleBotPauseResume] не удалось обновить данные клиента`, JSON.stringify(err));
      }

      const keyboard = new InlineKeyboard();
      updateKeyboard(client, keyboard);
      keyboard.row().text(
          pause ? '▶️ Возобновить бота' : '⏸️ Приостановить бота',
          `${pause ? 'resume' : 'pause'}_bot:${clientId}`
      );

      await ctx.editMessageReplyMarkup({reply_markup: keyboard});
      await ctx.answerCallbackQuery(
          pause
              ? `Бот приостановлен для ${getClientDisplayName(client)} на ${pauseBotTime} минут`
              : `Бот возобновлен для ${getClientDisplayName(client)}`
      );
    } catch (error) {
      console.error(`[${pause ? 'pause' : 'resume'}_bot] Ошибка:`, error);
      await ctx.answerCallbackQuery('Произошла ошибка');
    }
  }
}


const updateKeyboard = (client: Client, keyboard: InlineKeyboard) => {
  if (client.username) {
    keyboard.url(`Перейти в чат с ${client.first_name || client.username}`, `https://t.me/${client.username.startsWith('@') ? client.username.substring(1) : client.username}`);
  } else {
    keyboard.url(`Перейти в чат с ${client.first_name || 'пользователем'}`, `tg://user?id=${client.id}`);
  }
}