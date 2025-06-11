import { Bot, InlineKeyboard } from 'grammy'; // webhookCallback удален, так как не используется напрямую в handler
import fs from 'fs';
import path from 'path';

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  throw new Error('BOT_TOKEN must be provided!');
}
const bot = new Bot(botToken);

// Глобальная переменная для отслеживания инициализации
let botInitialized = false;

// Асинхронная функция для инициализации и настройки бота
async function initializeBot() {
  if (botInitialized) return;
  try {
    console.log('Initializing bot...');
    await bot.init(); // Явно инициализируем бота, чтобы получить botInfo (ctx.me)
    console.log(`Bot initialized: ${bot.botInfo.username} (ID: ${bot.botInfo.id})`);

    // Установка основных команд в меню бота
    // Это нужно делать после bot.init(), так как bot.api может быть не готов
    await bot.api.setMyCommands([
      { command: 'start', description: 'Начать работу с ботом' },
      { command: 'help', description: 'Показать справку' },
      { command: 'clients', description: 'Показать список клиентов' }
    ]);
    console.log('Bot commands set.');
    botInitialized = true;
  } catch (error) {
    console.error('Failed to initialize bot or set commands:', error);
    // В зависимости от критичности, можно либо выбросить ошибку дальше, либо продолжить без команд
    // throw error; // Раскомментируйте, если инициализация критична
  }
}

// Вызываем инициализацию один раз (например, при первом импорте модуля)
// В серверной среде это может выполниться при "холодном старте"
// initializeBot(); // Вызов здесь может быть проблематичен, если top-level await не поддерживается или вызывает проблемы
// Лучше вызывать его в начале handler, если это первый вызов.

interface Client { 
  id: string;
  firstName: string;
  lastName: string;
  category: 'buyer' | 'seller';
  status: 'active' | 'archived' | 'banned';
  username?: string;
  propertyInfo: {
    type: string;
    requirements?: string;
    description?: string;
    price?: number;
  };
}

// Функция для загрузки клиентов из JSON файла
const loadClients = (): Client[] => {
  try {
    const filePath = path.resolve(__dirname, 'clients.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent) as Client[];
  } catch (error) {
    console.error('Error loading clients.json:', error);
    return [];
  }
};

// Обработчик команды /start
bot.command('start', async (ctx) => {
  // ctx.me теперь должен быть доступен, если initializeBot() был вызван
  const firstName = ctx.from?.first_name || 'риелтор';
  const botUsername = ctx.me?.username || 'your_bot_username'; // Добавим запасной вариант
  const botLink = `https://t.me/${botUsername}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(botLink)}`;

  await ctx.replyWithPhoto(qrCodeUrl, {
    caption: `Привет, ${firstName}! 👋\n\nЯ ваш помощник в работе с недвижимостью. Используйте этот QR-код, чтобы поделиться моим контактом с клиентами.`
  });
});

// Команда /help
bot.command('help', async (ctx) => {
  await ctx.reply(
    'Доступные команды:\n' +
    '/start - Начать работу с ботом\n' +
    '/help - Показать это сообщение\n' +
    '/clients - Показать список всех клиентов'
  );
});

// Команда /clients
bot.command('clients', async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text('Активные клиенты', 'active_clients').row()
    .text('Архивные клиенты', 'archived_clients').row()
    .text('Заблокированные клиенты', 'blocked_clients');
  await ctx.reply('Выберите категорию клиентов:', { reply_markup: keyboard });
});

// Обработчики для действий с клиентами (callback_query)
bot.callbackQuery('active_clients', async (ctx) => {
  await ctx.answerCallbackQuery();
  const clients = loadClients();
  const activeClients = clients.filter(client => client.status === 'active');

  if (activeClients.length === 0) {
    await ctx.reply('Активных клиентов нет.');
    return;
  }

  const keyboard = new InlineKeyboard();
  activeClients.forEach(client => {
    keyboard.text(`${client.firstName} ${client.lastName}`, `client_${client.id}`).row();
  });

  await ctx.reply('Список активных клиентов:', { reply_markup: keyboard });
});

bot.callbackQuery('archived_clients', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Список архивных клиентов:');
  // TODO: Добавить логику получения списка архивных клиентов
});

bot.callbackQuery('blocked_clients', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Список заблокированных клиентов:');
  // TODO: Добавить логику получения списка заблокированных клиентов
});

// Обработчик для конкретного клиента (callback_query с regex)
bot.callbackQuery(/client_(.+)/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const clientId = ctx.match[1];
  const clients = loadClients();
  const client = clients.find(c => c.id === clientId);

  if (client) {
    let message = `*Информация о клиенте ${client.firstName} ${client.lastName}*\n\n` +
                  `*Категория:* ${client.category === 'buyer' ? 'Покупатель' : 'Продавец'}\n` +
                  `*Статус:* ${client.status === 'active' ? 'Активный' : client.status === 'archived' ? 'Архивный' : 'Заблокирован'}\n`;

    if (client.propertyInfo) {
      message += `\n*Информация по объекту:*\n`;
      if (client.propertyInfo.type) message += `  Тип: ${client.propertyInfo.type}\n`;
      if (client.propertyInfo.requirements) message += `  Требования: ${client.propertyInfo.requirements}\n`;
      if (client.propertyInfo.description) message += `  Описание: ${client.propertyInfo.description}\n`;
      if (client.propertyInfo.price) message += `  Цена: ${client.propertyInfo.price}\n`;
    }

    const keyboard = new InlineKeyboard();
    if (client.username) {
      keyboard.url(`Перейти в чат с ${client.firstName}`, `https://t.me/${client.username.startsWith('@') ? client.username.substring(1) : client.username}`);
    }

    if (keyboard.inline_keyboard.length > 0) {
      await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
      await ctx.reply(message, { parse_mode: 'Markdown' });
    }
  } else {
    await ctx.reply('Клиент не найден.');
  }
});

// Обработчик для приветствия
const greetingRegex = /^(привет|здравствуй|добрый день|доброе утро|добрый вечер|хелло|хай|салют)/i;
bot.hears(greetingRegex, async (ctx) => {
  console.log('Received event:', JSON.stringify(ctx));
  const businessConnectionId = ctx.businessConnectionId || ctx.message?.business_connection_id;
  if (businessConnectionId && ctx.chat.id === ctx.from?.id) {
    const now = new Date();
    const hour = now.getHours();
    let timeBasedGreeting = '';
    if (hour >= 5 && hour < 12) timeBasedGreeting = 'Доброе утро';
    else if (hour >= 12 && hour < 17) timeBasedGreeting = 'Добрый день';
    else if (hour >= 17 && hour < 22) timeBasedGreeting = 'Добрый вечер';
    else timeBasedGreeting = 'Доброй ночи';

    let userName = '';
    if (ctx.from?.first_name && /^[а-яА-ЯёЁ\s]+$/.test(ctx.from.first_name)) {
      userName = `, ${ctx.from.first_name}`;
    }

    const greetings = [
      `${timeBasedGreeting}${userName}`,
      `Здравствуй${userName}`,
      `Приветствую${userName}`,
      `Привет${userName}`,
      `${timeBasedGreeting.toLowerCase()}${userName}`
    ];
    let finalGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    if (Math.random() < 0.7) finalGreeting += '!';
    try {
      await ctx.reply(finalGreeting);
    } catch (error) {
      console.error('Error sending message via business connection:', error);
    }
  }
});

// Обработчик Cloud Function
export async function handler(event: any, context?: any) {
  console.log('Received event:', JSON.stringify(event));
  try {
    if (!botInitialized) {
      await initializeBot();
    }

    if (!event.body) {
      console.error('Event body is missing');
      return { statusCode: 400, body: 'Event body is missing' };
    }
    let updateString = event.body;
    if (typeof event.body !== 'string') {
        updateString = JSON.stringify(event.body);
    }
    const update = JSON.parse(updateString);
    console.log('Parsed update:', JSON.stringify(update));

    // Преобразуем business_message в стандартный формат сообщения Telegram
    if (update.business_message) {
      update.message = {
        ...update.business_message,
        business_connection_id: update.business_message.business_connection_id
      };
    }

    await bot.handleUpdate(update);
    return { statusCode: 200, body: 'OK' };

  } catch (err: any) {
    console.error('Error in handler:', err);
    const errorMessage = err.message || 'Unknown error';
    const errorStack = err.stack || 'No stack trace';
    console.error(`Error message: ${errorMessage}, Stack: ${errorStack}`);
    return { statusCode: 500, body: `Error processing update: ${errorMessage}` };
  }
}
