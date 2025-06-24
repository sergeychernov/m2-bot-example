import { Bot, Context } from "grammy";
import { clearChatMessages, getLastChatMessages } from "./ydb";

export async function debugClientCommands(bot: Bot) {
	bot.hears(/^:(\w+)\s*(.*)$/i, async (ctx) => {
		const command = ctx.match[1]; // команда после ':'
		const textAfterColon = ctx.match[2]; // текст после команды и пробелов
		switch (command) {
			case 'clear': {
				await clearHandler(ctx);
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
			default: {
				await helpHandler(ctx);
			} break;
		}
	});
}
  
  async function helpHandler(ctx: Context) {
	await ctx.reply(
	  'Доступные команды:\n'
	  + '*:clear* \\- очистить историю чата\n'
	  + '*:last n* \\- показать последние n сообщений',
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
	console.log('Received "last:" command:', JSON.stringify(ctx));
	  const chatId = ctx.chat?.id;
	  const userId = ctx.from?.id;
  
	if (!chatId || !userId) {
	  await ctx.reply('Не удалось определить ID чата.');
	  return;
	}
  
	try {
	  // Получаем iamToken, если он нужен для getLastTenChatMessages
	  // В вашем текущем getLastTenChatMessages iamToken опционален, 
	  // но если бы он был обязателен, его нужно было бы получить здесь, 
	  // например, из context в serverless-функции или другим способом.
	  const messages = await getLastChatMessages(chatId, userId, n);
  
	  if (messages.length === 0) {
		await ctx.reply('Сообщений в этом чате пока нет.');
		return;
	  }
  
	  let replyText = `Последние ${n} сообщений:\n`;
	  messages.forEach(msg => {
		const date = new Date(msg.timestamp); // YDB timestamp is in microseconds
		replyText += `\n[${date.toLocaleString()}] ${msg.type}: ${msg.message}`;
	  });
  
	  await ctx.reply(replyText);
  
	} catch (error) {
	  console.error(`Error fetching last ${n} chat messages:`, JSON.stringify(error));
	  await ctx.reply('Произошла ошибка при получении последних сообщений.');
	}
  }