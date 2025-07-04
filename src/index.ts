import { initializeClientsCommand } from './clients-command';
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
import { initializeStartCommand } from './start-command';
import { bot } from './bot-instance';
import {processAllUnansweredChats} from "./process-unanswered-messages";
import { handleVoiceMessage } from './voice-handler';
import { TelegramVoice } from './telegram-utils';
import { Context } from 'grammy';
import { initializeActivateCommand } from './activate-command';

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
      { command: 'demo', description: 'Демонстрация возможностей' },
      { command: 'activate', description: 'Привязать бизнес аккаунт к боту' }
    ]);
    console.log('Bot commands set.');
    // Команды /quiz и /start
    initializeStartCommand(bot);
    initializeQuiz(bot);
    initializeActivateCommand(bot);
    botInitialized = true;
  } catch (error) {
    console.error('Failed to initialize bot or set commands:', error);
    // В зависимости от критичности, можно либо выбросить ошибку дальше, либо продолжить без команд
    // throw error; // Раскомментируйте, если инициализация критична
  }
}

// Сначала регистрируем обработчики команд
initializeStartCommand(bot);
initializeQuiz(bot);
initializeActivateCommand(bot);

initializeClientsCommand(bot);

debugClientCommands(bot);

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

// Команда /demo
bot.command('demo', async (ctx) => {
  const userId = ctx.from?.id;
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
      const userId = ctx.from?.id;
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
export async function handler(event: any, context?: Context) {
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
    if (!event.body) {
      console.error('Event body is missing');
      return { statusCode: 400, body: 'Event body is missing' };
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
          // Обработка голосового сообщения
            if (update.business_message.voice) {
              const { file_id, duration, mime_type, file_size } = update.business_message.voice as TelegramVoice;
              if (duration < 30 && (file_size ?? 0) < 1000000 && mime_type) {
                const chatId = update.business_message.chat.id;
                const businessConnectionId = update.business_message.business_connection_id;
                
                console.log('Voice message received, processing with SpeechKit...');
                
                try {
                  const recognized = await handleVoiceMessage(file_id, chatId, mime_type, businessConnectionId, context);
                  if (recognized?.recognizedText) {
                    update.business_message.text = recognized?.recognizedText;
                  }
                } catch (voiceError) {
                    console.error('Error processing voice message:', voiceError);
                }
              } else {
                console.log('TODO: async voice processing')
              }
            }
      
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