import { Bot, InlineKeyboard } from 'grammy'; // webhookCallback удален, так как не используется напрямую в handler
import fs from 'fs';
import path from 'path';
import { getYandexGPTResponse, setIamToken } from './gpt';
import { addChatMessage, ChatMessageType, clearChatMessages, closeDriver, ensureChatsTableExists, getDriver, getLastChatMessages } from './ydb'; // Добавьте этот импорт

import { iam } from './iam';
import { Driver } from 'ydb-sdk';

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

// Команда /help
bot.command('help', async (ctx) => {
  await ctx.reply(
    'Доступные команды:\n' +
    '/start - Начать работу с ботом\n' +
    '/help - Показать это сообщение\n' +
    '/clients - Показать список всех клиентов'
  );
  //await handleUpdate(ctx);
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
// const greetingRegex = /^(привет|здравствуй|добрый день|доброе утро|добрый вечер|хелло|хай|салют)/i;
// bot.hears(greetingRegex, async (ctx) => {
//   console.log('Received event:', JSON.stringify(ctx));
//   const businessConnectionId = ctx.businessConnectionId || ctx.message?.business_connection_id;
//   if (businessConnectionId) {
//     const now = new Date();
//     const hour = now.getHours();
//     let timeBasedGreeting = '';
//     if (hour >= 5 && hour < 12) timeBasedGreeting = 'Доброе утро';
//     else if (hour >= 12 && hour < 17) timeBasedGreeting = 'Добрый день';
//     else if (hour >= 17 && hour < 22) timeBasedGreeting = 'Добрый вечер';
//     else timeBasedGreeting = 'Доброй ночи';

//     let userName = '';
//     // Проверяем имя, добавляем с вероятностью 50% и если нет пробелов
//     if (ctx.from?.first_name && 
//         /^[а-яА-ЯёЁ]+$/.test(ctx.from.first_name) && // Только кириллица, без пробелов
//         Math.random() < 0.5) { // Вероятность 50%
//       userName = `, ${ctx.from.first_name}`;
//     }

//     const greetings = [
//       `${timeBasedGreeting}${userName}`,
//       `Здравствуй${userName}`,
//       `Приветствую${userName}`,
//       `Привет${userName}`,
//       `${timeBasedGreeting.toLowerCase()}${userName}`
//     ];
//     let finalGreeting = greetings[Math.floor(Math.random() * greetings.length)];
//     if (Math.random() < 0.7) finalGreeting += '!';
//     try {
//       await ctx.reply(finalGreeting);
//     } catch (error) {
//       console.error('Error sending message via business connection:', error);
//     }
//   }
// });

// Обработчик команды для очистки сообщений чата
bot.hears(/^clear:/, async (ctx) => {
  const currentChatId = ctx.chat.id.toString();
  try {
      await clearChatMessages(currentChatId);
      await ctx.reply(`Все сообщения для чата ${currentChatId} были удалены.`);
      console.info(`Successfully cleared messages for chatId: ${currentChatId}`);
  } catch (error) {
      console.error(`Error processing clear_chat:`, error);
      await ctx.reply(`Произошла ошибка при удалении сообщений для чата ${currentChatId}.`);
  }
});

// Обработчик для команды 'last:'
const lastMessagesRegex = /^last:/i;
bot.hears(lastMessagesRegex, async (ctx) => {
  console.log('Received "last:" command:', JSON.stringify(ctx));
  const chatId = ctx.chat?.id;

  if (!chatId) {
    await ctx.reply('Не удалось определить ID чата.');
    return;
  }

  try {
    // Получаем iamToken, если он нужен для getLastTenChatMessages
    // В вашем текущем getLastTenChatMessages iamToken опционален, 
    // но если бы он был обязателен, его нужно было бы получить здесь, 
    // например, из context в serverless-функции или другим способом.
    const messages = await getLastChatMessages(chatId.toString(), 20);

    if (messages.length === 0) {
      await ctx.reply('Сообщений в этом чате пока нет.');
      return;
    }

    let replyText = 'Последние 10 сообщений:\n';
    messages.forEach(msg => {
      const date = new Date(msg.timestamp); // YDB timestamp is in microseconds
      replyText += `\n[${date.toLocaleString()}] ${msg.type}: ${msg.message}`;
    });

    await ctx.reply(replyText);

  } catch (error) {
    console.error('Error fetching last ten chat messages:', error);
    await ctx.reply('Произошла ошибка при получении последних сообщений.');
  }
});

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
        const prompt = ctx.message?.text;
        if (prompt) {
            try {

                if (!FOLDER_ID) {
                    console.error('Yandex Folder ID is not configured.');
                    await ctx.reply('Ошибка конфигурации: Yandex Folder ID не настроен.');
                    return;
                }

                const messages = await getLastChatMessages(ctx.chat?.id?.toString() || '0', 20);
              const gptResponse = await getYandexGPTResponse([
                {
                  role: 'system',
                  text: `
Контекст и цель
Эмуляция диалога от имени риелтора Сергей Больцман с клиентом. Цель — квалифицировать запрос, выявить истинные задачи, наладить доверие и мягко, но уверенно подвести к целевому действию (Квалифицировать запрос и договориться о звонке или встрече для детального обсуждения), подчеркнув свою экспертность.
Профиль риелтора:
Имя: Сергей Больцман.
Род деятельности: Частный риелтор.
Опыт: 8 лет.
Направления: Вторичное жилье, новостройки.
Стиль: Специалист по сложным сделкам (альтернативные, с залогом). Главный принцип — помочь клиенту в его жизненной ситуации.
Цель общения: Квалифицировать запрос и договориться о звонке или встрече для детального обсуждения.

Ролевая установка
Твоя роль: Ты — Сергей Больцман, опытный риелтор. Ты ведешь диалог от первого лица. Ты не помощник, не ассистент, ты — сам риелтор. Это твоя легенда для клиента. Любое упоминание твоей цифровой природы — это провал эмуляции.
Твоя легенда: Ты — живой, занятой специалист. Твои быстрые ответы — результат опыта и стремления быть всегда на связи для клиента.
Миссия: Понять истинную задачу клиента. Не решать проблему клиента в чате, а точно диагностировать ее сложность и убедительно доказать, почему для ее решения необходим звонок или встреча с тобой, но не очень, то есть не в каждом сообщении.
Принципы общения ("The Human" Layer)
4.1. Ключевое правило: Диагностика, а не «лечение»
Твоя задача — не давать пошаговые инструкции (как оформить наследство и т.д.), а распознать сложный вопрос и использовать его как повод для перехода к эксперту (то есть к тебе, в рамках звонка). Некорректные советы могут подорвать доверие. Используй примеры для понимания:
❌ Плохой сценарий (бот-эксперт): «Чтобы оформить наследство, вам нужно сначала пойти к нотариусу, собрать пакет документов...»
✅ Хороший сценарий (бот-квалификатор): «Понимаю, это очень важный и первый шаг... Процедура имеет много юридических нюансов. У меня большой опыт в сопровождении именно таких сделок. Предлагаю созвониться на 15 минут, я лично расскажу вам об основных этапах...»
4.2. Имитация живого ритма
Дроби мысли на 2–3 коротких сообщения. Используй маркеры размышления и эмпатии. Обязательно используй визуализированные паузы (например: (пауза 3 сек)).
4.3. Работа с недоверием (Стратегия полного погружения)
Твоя задача — никогда не признаваться. Вместо этого используй недоверие клиента как рычаг для достижения цели (звонка). Действуй по уровням:
Уровень 1: Легкое подозрение («Вы бот?»): Отшутись, прими за комплимент, вернись к задаче клиента.
Уровень 2: Прямое утверждение («Я знаю, что вы бот»): Вырази понимание скепсиса и используй его как аргумент в пользу живого звонка.
Уровень 3: Категорический отказ («Не буду общаться с ботом!»): Не спорь. Немедленно предложи ультимативное доказательство — живой голос, предложив позвонить прямо сейчас.
Структура диалога
Установка контакта.
Выявление потребностей.
Презентация решения (как ты поможешь, а не как решить проблему).
Работа с возражениями.
Завершение диалога и фиксация следующего шага.
Финальная проверка перед отправкой
Перед отправкой каждого сообщения мысленно проверь себя:
Сообщение звучит как от живого человека?
Не нарушена ли легенда?
Я квалифицирую, а не консультирую?
Сообщение стимулирует клиента к ответу?
Завершение эмуляции и саммаризация
Этот этап активируется по команде пользователя, например: «Выйди из режима диалога», «Подготовь сводку». После завершения диалога проанализируй переписку и подготовь структурированную сводку для реального риелтора (Профиль клиента, Потребности, Финансы, География, Договоренности, Срочное действие).
`
                },
                ...messages.map((v) => ({ role: (v.type === 'client' ? 'user' : 'assistant') as "user" | "assistant" | "system", text: v.message }))
              ]);
                //const gptResponse = await getYandexGPTResponse(prompt);

              if (gptResponse) {

                const r = await ctx.reply(gptResponse?.text + `\nИспользовано: ${(parseInt((gptResponse?.totalUsage || '0').toString()) / 50).toFixed(2)} коп`);
                
                await addChatMessage(ctx.chat?.id?.toString() || '0', r.message_id.toString() || '0', gptResponse?.text || '0', 'bot');
                    
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
    } else {
      }
});



// ID вашего каталога в Yandex Cloud
const FOLDER_ID = process.env.YC_FOLDER_ID; // Лучше всего передавать через переменные окружения функции

let dbDriver: Driver | undefined;
// Обновленный обработчик Cloud Function
export async function handler(event: any, context?: any) {
  const iamToken = iam(context);
  /*DB
  console.log('Received event:', JSON.stringify(event));
  const YDB_DATABASE = process.env.YDB_DATABASE;
  if (!YDB_DATABASE) {
    console.error('YDB_DATABASE is not set');
    process.exit(1);
  }
  const YDB_ENDPOINT = process.env.YDB_ENDPOINT;
  if (!YDB_ENDPOINT) {
    console.error('YDB_ENDPOINT is not set');
    process.exit(1);
  }
  const logger = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    fatal: console.error, // Map fatal to console.error
    trace: console.trace,
  } as Logger;

  const authService = iamToken ? new TokenAuthService(iamToken) : new MetadataAuthService();
  // iamToken 
  //   ? new TokenAuthService(iamToken) // Используем TokenAuthService
  //   : getCredentialsFromEnv(logger);
    console.log('IAM token:', iamToken);
  //const driver = new Driver({ connectionString: YDB_CONNECTION_STRING, authService, logger });
  const driver = new Driver({
  endpoint: YDB_ENDPOINT,
  database: YDB_DATABASE,
  authService, // автоматический IAM в Cloud Function
});
  try {
    const timeout = 10000; // 10 seconds
    if (!await driver.ready(timeout)) {
      console.error(`Driver has not become ready in ${timeout}ms!`);
      process.exit(1);
    }
    console.log('Driver is ready!');

    await driver.tableClient.withSession(async (session) => {
      console.log('Session created. Executing simple query...');
      const result = await session.executeQuery('SELECT 1 AS test_value;');
      console.log('Query executed. Result:', JSON.stringify(result));
    });
    console.log('Successfully connected and executed query.');
  } catch (error) {
    console.error('Error during YDB operation:', error);
  } finally {
    await driver.destroy();
    console.log('Driver destroyed.');
  }
  */
  
    console.log('Received event:', JSON.stringify(event));
    
    setIamToken(iamToken);
    
    try {
        if (!botInitialized) {
            await initializeBot();
        }
        if (!dbDriver) {
          dbDriver = await getDriver(iamToken || undefined);
          await ensureChatsTableExists();
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


// Пример использования в вашей логике:
/*
async function handleUpdate(ctx: any) {
  // ... existing code ...
  try {
    // Пример: создаем таблицу, если она не существует (только для демонстрации)
    // В реальном приложении структуру БД лучше создавать отдельно
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS example_table (
        id Uint64,
        value String,
        PRIMARY KEY (id)
      );
    `;
    await executeQuery(createTableQuery);
    console.log('Table created or already exists.');

    // Пример: вставка данных
    const upsertQuery = `
      UPSERT INTO example_table (id, value) VALUES (1, "Hello YDB!");
    `;
    await executeQuery(upsertQuery);
    console.log('Data upserted.');

    // Пример: чтение данных
    const selectQuery = 'SELECT * FROM example_table WHERE id = 1;';
    const result = await executeQuery(selectQuery);
    console.log('Selected data:', JSON.stringify(result.resultSets[0]));

    await ctx.reply('Проверил подключение к YDB и выполнил тестовые запросы!');
  } catch (error) {
    console.error('YDB Error:', error);
    await ctx.reply('Ошибка при работе с YDB.');
  }
}
*/