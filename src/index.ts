import { Bot } from 'grammy';
import { initializeClientsCommand } from './clients';
import { setIamToken } from './gpt';
import {
    ChatMessageType,
    Client,
    getDriver,
    getMode,
    setClient,
    setMode,
    UserMode,
} from './ydb';

import { iam } from './iam';
import { Driver } from 'ydb-sdk';
import { setupDatabase } from './setup-db';
import { renderSettingsPage } from './settings.fe';
import { handleSettingsPost } from './settings.be'; // <<< Добавлен этот импорт
import { debugClientCommands } from './debug-client-commands';
import { chatHandler } from './chat-handler';
import { initializeQuiz } from './quiz-handler';

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
      { command: 'quiz', description: 'Пройти квиз' },
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

// interface Client { 
//   id: string;
//   firstName: string;
//   lastName: string;
//   category: 'buyer' | 'seller';
//   status: 'active' | 'archived' | 'banned';
//   username?: string;
//   propertyInfo: {
//     type: string;
//     requirements?: string;
//     description?: string;
//     price?: number;
//   };
// }

// Функция для загрузки клиентов из JSON файла
// const loadClients = (): Client[] => {
//   try {
//     const filePath = path.resolve(__dirname, 'clients.json'); // Путь теперь относительно __dirname внутри src
//     const fileContent = fs.readFileSync(filePath, 'utf-8');
//     return JSON.parse(fileContent) as Client[];
//   } catch (error) {
//     console.error('Error loading clients.json:', error);
//     return [];
//   }
// };

// Команды /quiz и /start
initializeQuiz(bot);

// Команда /help
bot.command('help', async (ctx) => {
    await ctx.reply(
        'Доступные команды:\n' +
        '/start - Начать работу с ботом\n' +
        '/help - Показать это сообщение\n' +
        '/clients - Показать список всех клиентов\n' +
        '/quiz - Пройти квиз\n' +
        '/demo - Демонстрация возможностей'
    );
});


initializeClientsCommand(bot);

// Команда /demo
bot.command('demo', async (ctx) => {
  const userId = ctx.from?.id.toString();
  if (!userId) {
    await ctx.reply('Не удалось определить ваш ID.');
    return;
  }

  try {
    const currentMode = await getMode(userId);
    if (currentMode === 'demo') {
      await setMode(userId, 'none');
      await ctx.reply('Режим демонстрации выключен.');
    } else {
      await setMode(userId, 'demo');
      await ctx.reply(`Режим демонстрации включен. Теперь вы можете пообщаться со своим аватаром отсюда.`);
    }
  } catch (error) {
    console.error('Failed to toggle demo mode:', error);
    await ctx.reply('Произошла ошибка при переключении режима демонстрации.');
  }
});

debugClientCommands(bot);

// Новый обработчик для сообщений, начинающихся с 'y:'
const yandexGptRegex = /^(.*)/i;
// от бота не перехватывает
bot.hears(yandexGptRegex, async (ctx, next) => {
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
  console.log('type:', type);
  switch (type) {
    case 'client':
      if (businessConnectionId) {
        setClient(ctx.from as Client);
        await chatHandler(ctx, type);
      }
      break;
    case 'realtor':
      break;
    case 'admin':
      const userId = ctx.from?.id.toString();
      const mode:UserMode = userId?await getMode(userId):'none';
      if (mode === 'demo') {
        setClient(ctx.from as Client);
        await chatHandler(ctx, type);
        //console.log('demo', JSON.stringify(ctx));
        //await ctx.reply('Режим демонстрации: вы не можете общаться с администратором.');
      }
      break;

  }

  await next();
});

let dbDriver: Driver | undefined;
// let initialPromptAdded = false; // Удаляем этот флаг

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
      return await renderSettingsPage(event);
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
        console.error(`Error message: ${JSON.stringify(errorMessage)}, Stack: ${JSON.stringify(errorStack)}`);
        return { statusCode: 500, body: `Error processing update: ${errorMessage}` };
    }
  
}