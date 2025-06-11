import { Telegraf, Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Установка основных команд в меню бота
bot.telegram.setMyCommands([
  { command: 'start', description: 'Начать работу с ботом' },
  { command: 'help', description: 'Показать справку' },
  { command: 'clients', description: 'Показать список клиентов' }
]);

// Обработчик команды /start
bot.command('start', async (ctx) => {
  const firstName = ctx.from?.first_name || 'риелтор';
  
  // Создаем QR-код с ссылкой на бота
  const botLink = `https://t.me/${bot.botInfo?.username}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(botLink)}`;
  
  await ctx.replyWithPhoto({ url: qrCodeUrl }, {
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
  await ctx.reply(
    'Выберите категорию клиентов:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Активные клиенты', 'active_clients')],
      [Markup.button.callback('Архивные клиенты', 'archived_clients')],
      [Markup.button.callback('Заблокированные клиенты', 'blocked_clients')]
    ])
  );
});

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
    const filePath = path.join(__dirname, 'clients.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent) as Client[];
  } catch (error) {
    console.error('Error loading clients.json:', error);
    return [];
  }
};

// Обработчики для действий с клиентами
bot.action('active_clients', async (ctx) => {
  await ctx.answerCbQuery();
  const clients = loadClients();
  const activeClients = clients.filter(client => client.status === 'active');

  if (activeClients.length === 0) {
    await ctx.reply('Активных клиентов нет.');
    return;
  }

  const clientButtons = activeClients.map(client => 
    [Markup.button.callback(`${client.firstName} ${client.lastName}`, `client_${client.id}`)]
  );

  await ctx.reply('Список активных клиентов:', Markup.inlineKeyboard(clientButtons));
});

bot.action('archived_clients', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Список архивных клиентов:');
  // TODO: Добавить логику получения списка архивных клиентов
});

bot.action('blocked_clients', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Список заблокированных клиентов:');
  // TODO: Добавить логику получения списка заблокированных клиентов
});

// Обработчики для новых команд меню
bot.hears('Список активных клиентов', async (ctx) => {
  await ctx.reply('Здесь будет список активных клиентов.');
  // TODO: Добавить логику для отображения активных клиентов
});

bot.hears('Список архивных клиентов', async (ctx) => {
  await ctx.reply('Здесь будет список архивных клиентов.');
  // TODO: Добавить логику для отображения архивных клиентов
});

bot.hears('Помощь', async (ctx) => {
  // Переиспользуем логику команды /help
  await ctx.reply(
    'Доступные команды:\n' +
    '/start - Начать работу с ботом\n' +
    '/help - Показать это сообщение\n' +
    '/clients - Показать список всех клиентов\n\n' +
    'Также вы можете использовать кнопки меню для:\n' +
    '• Просмотра активных клиентов\n' +
    '• Просмотра архивных клиентов\n' +
    '• Получения помощи'
  );
});

// Обработчик для конкретного клиента
bot.action(/client_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const clientId = ctx.match[1]; // Теперь это ID клиента, например, CL001
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

    const keyboardButtons = [];
    if (client.username) {
      keyboardButtons.push([Markup.button.url(`Перейти в чат с ${client.firstName}`, `https://t.me/${client.username.startsWith('@') ? client.username.substring(1) : client.username}`)]);
    }

    if (keyboardButtons.length > 0) {
      await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(keyboardButtons));
    } else {
      await ctx.replyWithMarkdown(message);
    }
  } else {
    await ctx.reply('Клиент не найден.');
  }
});

// Обработчик для приветствия
bot.hears(/^(привет|здравствуй|добрый день|доброе утро|добрый вечер|хелло|хай|салют)/i, async (ctx) => {
  const businessConnectionId = (ctx.update as any).message?.business_connection_id || (ctx.update as any).business_message?.business_connection_id;

  const now = new Date();
  const hour = now.getHours(); // Получаем текущий час (0-23)

  let greeting = 'Привет!'; // Приветствие по умолчанию

  if (hour >= 5 && hour < 12) {
    greeting = 'Доброе утро!';
  } else if (hour >= 12 && hour < 17) {
    greeting = 'Добрый день!';
  } else if (hour >= 17 && hour < 22) {
    greeting = 'Добрый вечер!';
  } else {
    greeting = 'Доброй ночи!';
  }

  if (businessConnectionId) {
    try {
      await ctx.telegram.sendMessage(ctx.chat.id, greeting, {
        // @ts-ignore - business_connection_id is required for business messages but not in type definitions
        business_connection_id: businessConnectionId
      });
    } catch (error) {
      console.error('Error sending message via business connection:', error);
    }
  } else {
    console.warn('business_connection_id not found, replying normally.');
    await ctx.reply(greeting);
  }
});

// Обработчик Cloud Function
export async function handler(event: any) {
	console.log('Received event:', JSON.stringify(event)); 
  try {
    // Yandex Cloud передаёт вебхук в body
    let update = JSON.parse(event.body);

    // Если это бизнес-сообщение, попробуем "нормализовать" его для Telegraf
    if (update.business_message) {
      console.log('Processing business_message:', JSON.stringify(update.business_message, null, 2));
      // Копируем основные поля из business_message в message.
      // Важно также скопировать business_connection_id, если он там есть.
      update.message = {
        ...update.business_message, // Распространяем все поля из business_message
        // Явно указываем ключевые поля, которые Telegraf использует
        message_id: update.business_message.message_id,
        date: update.business_message.date,
        chat: update.business_message.chat,
        from: update.business_message.from,
        text: update.business_message.text,
        // business_connection_id должен быть здесь, если он есть в business_message
        // Telegraf может не передавать его автоматически в ctx, поэтому мы его здесь сохраняем
      };
      // Оставляем оригинальный business_message, Telegraf может его использовать для контекста
      // или для других типов middleware.
    }

    await bot.handleUpdate(update);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Error in handler:', err);
    return { statusCode: 500, body: 'Error processing update' };
  }
}
