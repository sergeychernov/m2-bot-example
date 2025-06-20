import { Bot,  InlineKeyboard } from 'grammy'; 
import fs from 'fs'; // fs больше не нужен здесь для system_prompt.md
import path from 'path'; // path больше не нужен здесь для system_prompt.md
import { getYandexGPTResponse, setIamToken } from './gpt'; 
import { 
    addChatMessage, 
    ChatMessageType,
    getDriver, 
    getLastChatMessages,
} from './ydb'; 

import { iam } from './iam';
import { Driver } from 'ydb-sdk';
import { imitateTyping } from './telegram-utils';
import { setupDatabase } from './setup-db';
import { renderSettingsPage } from './settings.fe';
import { handleSettingsPost } from './settings.be'; // <<< Добавлен этот импорт
import { debugClientCommands } from './debug-client-commands';

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
      { command: 'clients', description: 'Показать список клиентов' },
      { command: 'demo', description: 'Демонстрация возможностей' }
    ]);
    console.log('Bot commands set.');
    botInitialized = true;
  } catch (error) {
    console.error('Failed to initialize bot or set commands:', error);
    // В зависимости от критичности, можно либо выбросить ошибку дальше, либо продолжить без команд
    // throw error; // Раскомментируйте, если инициализация критична
  }
}

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
    const filePath = path.resolve(__dirname, 'clients.json'); // Путь теперь относительно __dirname внутри src
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

bot.command('help', async (ctx) => {
  await ctx.reply(
    'Доступные команды:\n' +
    '/start - Начать работу с ботом\n' +
    '/help - Показать это сообщение\n' +
    '/clients - Показать список всех клиентов\n' +
    '/demo - Демонстрация возможностей'
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

debugClientCommands(bot);

// Новый обработчик для сообщений, начинающихся с 'y:'
const yandexGptRegex = /^(.*)/i;
// от бота не перехватывает
bot.hears(yandexGptRegex, async (ctx) => {
    console.log('Received Yandex GPT command:', JSON.stringify(ctx));
  const businessConnectionId = ctx.businessConnectionId || ctx.message?.business_connection_id;
  let type: ChatMessageType;
  if (!businessConnectionId) {
    type = 'admin';
  } else if (ctx.from?.is_bot) {
    type = 'bot';
  } else if (ctx.from?.id === ctx.chat?.id) {
    type = 'client';
  } else {
    type = 'realtor'
  }
    await addChatMessage(ctx.chat?.id?.toString() || '0', ctx.message?.message_id?.toString() || '0', ctx.message?.text || '0', type);
    if (businessConnectionId && type === 'client') {
        const promptText = ctx.message?.text; // Переименовал prompt в promptText для ясности
        if (promptText) {
            try {

                if (!FOLDER_ID) {
                    console.error('Yandex Folder ID is not configured.');
                    await ctx.reply('Ошибка конфигурации: Yandex Folder ID не настроен.');
                    return;
                }

                const historyMessages = await getLastChatMessages(ctx.chat?.id?.toString() || '0', 20);
                // Формируем только сообщения пользователя и ассистента для передачи в getYandexGPTResponse
                const gptMessages = historyMessages.map((v) => ({
                    role: (v.type === 'client' ? 'user' : 'assistant') as 'user' | 'assistant',
                    text: v.message
                }));
                
                const currentUserData = loadUserData(); // Загружаем данные пользователя
                // Исправленный вызов с передачей currentUserData
                const gptResponse = await getYandexGPTResponse(gptMessages, currentUserData); 
                
                if (gptResponse && gptResponse.text) {
                

                // Рассчитываем задержку
                const textToReply = gptResponse.text;
                const startDelay = promptText.length * 100 + 2000; // Changed from prompt.length
                const delay = textToReply.length * 200; // 300 мс на символ
                await imitateTyping(ctx, startDelay, delay);

                const r = await ctx.reply(textToReply + `\nИспользовано: ${(parseInt((gptResponse?.totalUsage || '0').toString()) / 50).toFixed(2)} коп`);
                
                await addChatMessage(ctx.chat?.id?.toString() || '0', r.message_id.toString() || '0', textToReply, 'bot');
                    
              } else {
                    await ctx.reply('Не удалось получить ответ от YandexGPT.');
                }
            } catch (error) {
                console.error('Error processing Yandex GPT request:', JSON.stringify(error));
                await ctx.reply('Произошла ошибка при обработке вашего запроса к YandexGPT.');
            }
        } else {
            await ctx.reply('Пожалуйста, укажите ваш запрос после "y:". Например: y: расскажи анекдот');
        }
    } else {
      }
});



const FOLDER_ID = process.env.YC_FOLDER_ID; 

let dbDriver: Driver | undefined;
// let initialPromptAdded = false; // Удаляем этот флаг

// Команда /demo
bot.command('demo', async (ctx) => {
  await ctx.reply(
    'Это демонстрационная команда. Здесь вы можете показать различные возможности бота.'
  );
});

// Обновленный обработчик Cloud Function
export async function handler(event: any, context?: any) {
  console.log('Received event:', JSON.stringify(event));
  const iamToken = iam(context);
  setIamToken(iamToken);
  
    
  try {
    if (!dbDriver) {
      dbDriver = await getDriver(iamToken || undefined);
    }
    if (event.setup_database === true) {// создание таблиц
      await setupDatabase();
      return { statusCode: 200, body: 'DB initialized' };
    }
    if (event.httpMethod === 'GET') {//редактор глобальных настроек
      return await renderSettingsPage();
    }
    if (!event.body) {
      console.error('Event body is missing');
      return { statusCode: 400, body: 'Event body is missing' };
  }
    if (event.isBase64Encoded) {//бекенд глобальных настроек
      if (event.httpMethod === 'POST') {
      return await handleSettingsPost(event);
      }
    }
        if (!botInitialized) {
            await initializeBot();
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

    } catch (error: any) {
        console.error('Error in handler:', JSON.stringify(error));
        const errorMessage = error.message || 'Unknown error';
        const errorStack = error.stack || 'No stack trace';
        console.error(`Error message: ${errorMessage}, Stack: ${JSON.stringify(errorStack)}`);
        return { statusCode: 500, body: `Error processing update: ${errorMessage}` };
    }
  
}

interface UserDataItem {
    name: string;
    value: string;
}

let userData: UserDataItem[] | null = null;

function loadUserData(): UserDataItem[] {
    if (userData) {
        return userData;
    }
    try {
        const userConfigPath = path.resolve(__dirname, 'user.json');
        const userConfigFile = fs.readFileSync(userConfigPath, 'utf-8');
        userData = JSON.parse(userConfigFile) as UserDataItem[];
        return userData;
    } catch (error) {
        console.error('Failed to load user.json:', error);
        return [];
    }
}