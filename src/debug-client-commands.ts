import { Bot, Context, NextFunction } from "grammy";
import { clearChatMessages, getLastChatMessages } from "./ydb";
import { getBusinessConnectionIdByUserId, getUserIdByBusinessConnectionId } from "./users";
import { getClient, setClient } from './ydb';

export async function debugClientCommands(bot: Bot) {
	const commandHandler = async (ctx: Context, next: NextFunction) => {
		console.log('debugClientCommands', ctx.message?.text);
        const text = (ctx.message||ctx.businessMessage)?.text;
		if (!text?.startsWith(':')) {
			await next();
			return;
		}

        const match = text.match(/^:(\w+)\s*(.*)$/i);
        if (!match) {
			await next();
			return;
		}

        const command = match[1];
        const textAfterColon = match[2];

        switch (command) {
            case 'clear': {
                await clearHandler(ctx);
            } break;
            case 'id': {
                await ctx.reply(`ID чата: ${ctx.chat?.id}, ID пользователя: ${ctx.from?.id}, business_connection_id: ${ctx.businessConnectionId}`);
            } break;
            case 'last': {
                let n = 20;
                try {
                    n = parseInt(textAfterColon);
                    if (isNaN(n)) {
                        n = 20;
                    }
                } catch (error) {
                    console.log(`textAfterColon: ${textAfterColon}`);
                    console.error('Error parsing last count:', JSON.stringify(error));
                }
                await lastHandler(ctx, n);
            } break;
            case 'quick': {
                const chatId = ctx.chat?.id;
                if (!chatId) {
                  await ctx.reply('Не удалось определить ID чата.');
                  break;
                }
                const client = await getClient(chatId);
                if (client) {
                  const newClient = { ...client, quickMode: !client.quickMode };
                  await Promise.all([
                    setClient(newClient),
                    ctx.reply(newClient.quickMode
                      ? '⚡ Быстрый режим ВКЛЮЧЁН для этого чата.'
                      : '⏳ Быстрый режим ВЫКЛЮЧЕН для этого чата.')
                  ]);
                } else {
                  await ctx.reply('Не удалось найти клиента для этого чата.');
                }
            } break;
            default: {
                await helpHandler(ctx);
            } break;
        }
    };

    // Обработка обычных сообщений
    bot.on('message', commandHandler);
    // Обработка бизнес-сообщений
    bot.on('business_message', commandHandler);
}
  
  async function helpHandler(ctx: Context) {
	await ctx.reply(
	  'Доступные команды:\n'
	  + '*:clear* \\- очистить историю чата\n'
		+ '*:last n* \\- показать последние n сообщений\n'
	  + '*:id* \\- показать ID чата, ID пользователя и business_connection_id\n'
      + '*:quick* \\- переключить быстрый режим для этого чата\n',
	  { parse_mode: 'MarkdownV2' }
	);
  }
  
  async function clearHandler(ctx: Context) {
	const currentChatId = ctx.chat?.id;
	try {
	  if (currentChatId) {
		await clearChatMessages(currentChatId);
		await ctx.reply(`Все сообщения для чата ${currentChatId} были удалены.`);
		console.info(`Successfully cleared messages for chatId: ${currentChatId}`);
	  }
		
	} catch (error) {
		console.error(`Error processing clear_chat:`, JSON.stringify(error));
		await ctx.reply(`Произошла ошибка при удалении сообщений для чата ${currentChatId}.`);
	}
  }
  
  async function lastHandler(ctx: Context, n = 20): Promise<void> {
	const chatId = ctx.chat?.id;
	const userId = ctx.from?.id;
	const business_connection_id = ctx.businessConnectionId || await getBusinessConnectionIdByUserId(userId || 0) || '';
	
	console.log('Received "last:" command:', JSON.stringify(ctx), chatId, userId);
  
	if (!chatId || !userId) {
	  await ctx.reply('Не удалось определить ID чата.');
	  return;
	}
  
	try {
	  const messages = await getLastChatMessages(chatId, business_connection_id, n);
  
	  if (messages.length === 0) {
		await ctx.reply('Сообщений в этом чате пока нет.');
		return;
	  }
  
	  let replyText = `Последние ${n} сообщений:\n`;
	  messages.forEach(msg => {
		const date = new Date(msg.timestamp); // YDB timestamp is in microseconds
		replyText += `\n[${date.toLocaleString()}] ${msg.who.role}: ${msg.message}`;
	  });
  
	  await ctx.reply(replyText);
  
	} catch (error) {
	  console.error(`Error fetching last ${n} chat messages:`, JSON.stringify(error));
	  await ctx.reply('Произошла ошибка при получении последних сообщений.');
	}
  }