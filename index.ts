import { Bot, InlineKeyboard } from 'grammy'; // webhookCallback удален, так как не используется напрямую в handler
import fs from 'fs';
import path from 'path';
// Удалите импорт node-fetch полностью
// import fetch from 'node-fetch';

// Используйте глобальный fetch (доступен в Node.js 18+)
// Никаких дополнительных импортов не требуется

// Прямые импорты для Yandex Text Generation API
// Remove this incorrect import:
// import { 
//     Message as GPTMessage, 
//     TextGenerationRequest 
// } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/ai/foundation_models/v1/text_generation';

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
  if (businessConnectionId) {
    const now = new Date();
    const hour = now.getHours();
    let timeBasedGreeting = '';
    if (hour >= 5 && hour < 12) timeBasedGreeting = 'Доброе утро';
    else if (hour >= 12 && hour < 17) timeBasedGreeting = 'Добрый день';
    else if (hour >= 17 && hour < 22) timeBasedGreeting = 'Добрый вечер';
    else timeBasedGreeting = 'Доброй ночи';

    let userName = '';
    // Проверяем имя, добавляем с вероятностью 50% и если нет пробелов
    if (ctx.from?.first_name && 
        /^[а-яА-ЯёЁ]+$/.test(ctx.from.first_name) && // Только кириллица, без пробелов
        Math.random() < 0.5) { // Вероятность 50%
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

// Новый обработчик для сообщений, начинающихся с 'y:'
const yandexGptRegex = /^y:(.*)/i;
// Обработчик для команд 'y:'
bot.hears(yandexGptRegex, async (ctx) => {
    console.log('Received Yandex GPT command:', JSON.stringify(ctx));
    const businessConnectionId = ctx.businessConnectionId || ctx.message?.business_connection_id;

    if (businessConnectionId && ctx.match && ctx.match[1]) {
        const prompt = ctx.match[1].trim();
        if (prompt) {
            try {
                await ctx.reply('Yandex обрабатывает ваш запрос...');

                const yandexFolderID = process.env.YC_FOLDER_ID || 'YOUR_YANDEX_FOLDER_ID';

                if (!yandexFolderID || yandexFolderID === 'YOUR_YANDEX_FOLDER_ID') {
                    console.error('Yandex Folder ID is not configured.');
                    await ctx.reply('Ошибка конфигурации: Yandex Folder ID не настроен.');
                    return;
                }

                // Вызываем функцию с двумя параметрами (убираем iamToken)
                const gptResponse = await getYandexGPTResponse(prompt, yandexFolderID);

                if (gptResponse) {
                    await ctx.reply(gptResponse);
                } else {
                    await ctx.reply('Не удалось получить ответ от YandexGPT.');
                }
            } catch (error) {
                console.error('Error processing Yandex GPT request:', error);
                await ctx.reply('Произошла ошибка при обработке вашего запроса к YandexGPT.');
            }
        } else {
            await ctx.reply('Пожалуйста, укажите ваш запрос после "y:". Например: y: расскажи анекдот');
        }
    } else if (businessConnectionId) {
        await ctx.reply('Для запроса к YandexGPT, пожалуйста, используйте формат "y: ваш запрос".');
    }
});

// Обработчик Cloud Function
// Remove this entire first handler function (lines ~252-280):
// export async function handler(event: any, context?: any) {
//   console.log('Received event:', JSON.stringify(event));
//   try {
//     if (!botInitialized) {
//       await initializeBot();
//     }

//     if (!event.body) {
//       console.error('Event body is missing');
//       return { statusCode: 400, body: 'Event body is missing' };
//     }
//     let updateString = event.body;
//     if (typeof event.body !== 'string') {
//         updateString = JSON.stringify(event.body);
//     }
//     const update = JSON.parse(updateString);
//     console.log('Parsed update:', JSON.stringify(update));

//     // Преобразуем business_message в стандартный формат сообщения Telegram
//     if (update.business_message) {
//         update.message = {
//             ...update.business_message,
//             business_connection_id: update.business_message.business_connection_id
//         };
//     }

//     await bot.handleUpdate(update);
//     return { statusCode: 200, body: 'OK' };

// } catch (err: any) {
//     console.error('Error in handler:', err);
//     const errorMessage = err.message || 'Unknown error';
//     const errorStack = err.stack || 'No stack trace';
//     console.error(`Error message: ${errorMessage}, Stack: ${errorStack}`);
//     return { statusCode: 500, body: `Error processing update: ${errorMessage}` };
// }

// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.FOLDER_ID; // Лучше всего передавать через переменные окружения функции
const YANDEX_GPT_MODEL_LITE_URI = `gpt://${FOLDER_ID}/yandexgpt-lite`;

import {
    Session,
    serviceClients,
    cloudApi, // Ensure cloudApi is imported if you need types from it
} from '@yandex-cloud/nodejs-sdk';

// Placeholder types - you'll need to find the correct ones or define them
// based on Yandex Cloud API documentation if not easily importable.
// For now, as a fallback:
// type TextGenerationRequest = any; // Already defined
// type GPTMessage = any; // Already defined

// Глобальная переменная для хранения IAM токена из контекста
let currentIamToken: string | null = null;

// Обновленная функция getYandexGPTResponse
// Добавьте логирование для проверки Folder ID
async function getYandexGPTResponse(prompt: string, folderId: string): Promise<string | null> {
    try {
        // Проверяем, что у нас есть IAM токен из контекста
        if (!currentIamToken) {
            console.error('IAM token not available from function context');
            return 'Ошибка: IAM токен недоступен';
        }

        // Добавляем логирование для отладки
        console.log('Using IAM token type:', typeof currentIamToken);
        console.log('IAM token length:', currentIamToken.length);
        console.log('IAM token starts with:', currentIamToken.substring(0, 10));
        console.log('Using folder ID:', folderId); // Добавьте эту строку
        
        // Используем прямой HTTP запрос к Foundation Models API
        const url = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';
        
        const requestBody = {
            // Попробуйте этот вариант:
            modelUri: `gpt://${folderId}/yandexgpt-lite/latest`,
            // Или этот:
            // modelUri: `gpt://${folderId}/yandexgpt/latest`,
            completionOptions: {
                stream: false,
                temperature: 0.6,
                maxTokens: 2000
            },
            messages: [
                {
                    role: 'user',
                    text: prompt
                }
            ]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentIamToken}`,
                'x-folder-id': folderId
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('YandexGPT API error:', response.status, errorText);
            return `Ошибка API: ${response.status} - ${errorText}`;
        }

        // Add this interface at the top of the file
        interface YandexGPTResponse {
            result: {
                alternatives: Array<{
                    message: {
                        text: string;
                    };
                }>;
            };
        }

        // Then use it in the function:
        const result = await response.json() as YandexGPTResponse;
        
        if (result.result && result.result.alternatives && result.result.alternatives.length > 0) {
            return result.result.alternatives[0].message.text;
        } else {
            console.error('Unexpected response format:', result);
            return 'Ошибка: Неожиданный формат ответа от YandexGPT';
        }
        
    } catch (error: any) {
        console.error('Error getting Yandex GPT response:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Ошибка: ${errorMessage}`;
    }
}

// Обновленный обработчик Cloud Function
export async function handler(event: any, context?: any) {
    console.log('Received event:', JSON.stringify(event));
    
    // ВАЖНО: Получаем IAM токен из контекста функции
    if (context && context.token) {
        // Исправление: используем access_token из объекта token
        if (typeof context.token === 'string') {
            currentIamToken = context.token;
        } else if (context.token.access_token) {
            currentIamToken = context.token.access_token;
        } else {
            console.error('Invalid token format in context:', context.token);
            currentIamToken = null;
        }
        console.log('IAM token received from function context');
    } else {
        console.error('IAM token not found in function context');
        currentIamToken = null;
    }
    
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
