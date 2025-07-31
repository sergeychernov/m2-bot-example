import { initializeClientsCommand } from './clients-command';
import { setIamToken } from './gpt';
import {
    addChatMessage,
    changeAnsweredStatus,
    getDriver,
    getMode,
    setMode,
    updateChatMessage,
    updateUserBusinessConnection,
    UserMode,
} from './ydb';
import { Client, getClient, setClient } from './clients';

import { iam } from './iam';
import { Driver } from 'ydb-sdk';
import { setupDatabase } from './setup-db';
import { debugClientCommands } from './debug-client-commands';
import { chatHandler } from './chat-handler';
import { initializeQuiz, startQuizWithFreshConfig } from './quiz-handler';
import { initializeStartCommand } from './start-command';
import { bot } from './bot-instance';
import { handleVoiceMessage } from './voice-handler';
import { TelegramVoice, isUserProfileComplete, Who } from './telegram-utils';
import { Api, Bot, Context, RawApi } from 'grammy';
import { initializeActivateCommand } from './activate-command';
import { Message } from 'grammy/types';
import { getUserIdByBusinessConnectionId } from './users';
import { handleMediaMessage } from './media-handler';
import { getUnansweredMessageIds } from './process-unanswered-messages';
import { getAddressFromLocation } from './location-handler';

// Глобальная переменная для отслеживания инициализации
let botInitialized = false;

// Асинхронная функция для инициализации и настройки бота
async function initializeBot() {
  if (botInitialized) return;
  try {
    console.log('Initializing bot...');
    await bot.init(); // Явно инициализируем бота, чтобы получить botInfo (ctx.me)
    console.log(`Bot initialized: ${bot.botInfo.username} (ID: ${bot.botInfo.id})`);

    await bot.api.setMyCommands([
      { command: 'start', description: 'Начать работу с ботом' },
      { command: 'help', description: 'Показать справку' },
      { command: 'clients', description: 'Показать список клиентов' },
      { command: 'quiz', description: 'Пройти квиз' },
      { command: 'demo', description: 'Демонстрация возможностей' },
      { command: 'activate', description: 'Привязать бизнес аккаунт к боту' }
    ]);
    console.log('Bot commands set.');
    // Сначала регистрируем обработчики команд
    initializeStartCommand(bot);
    initializeQuiz(bot);
    initializeActivateCommand(bot);
    initializeClientsCommand(bot);
    debugClientCommands(bot);
    initializeChat(bot);
    botInitialized = true;
  } catch (error) {
    console.error('Failed to initialize bot or set commands:', error);
  }
}


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
        if (!(await isUserProfileComplete(userId))) {
            await ctx.api.sendMessage(userId, 'Сначала полностью заполните профиль, пройдя опросник с помощью команды /quiz');
            return;
        }
      await setMode(userId, 'demo');
      await ctx.reply(`Режим демонстрации включен. Теперь вы можете пообщаться со своим аватаром отсюда.`);
    }
  } catch (error) {
    console.error('Failed to toggle demo mode:', error);
    await ctx.reply('Произошла ошибка при переключении режима демонстрации.');
  }
});

async function chat(ctx: Context, who: Who, message: Message) {
  console.log('chat.message:', JSON.stringify(message));
  const userId = await getUserIdByBusinessConnectionId(ctx?.businessConnectionId||'')||0;
  const mode = await getMode(message.chat.id);

  // TODO: реализовать распознавание файлов
  if (message.photo || message.animation || message.document || message.video || message.video_note || message.audio) {
      try {
          const id = mode === 'demo' ? message.chat.id : userId;
          await handleMediaMessage(ctx, message, id);
      } catch (e) {
          console.error('[chat]: Ошибка при отправке уведомления о медиа:', e);
      }
      return;
  }

  if (message.voice) {
    const { file_id, duration, mime_type, file_size } = message.voice as TelegramVoice;
    if (duration < 30 && (file_size ?? 0) < 1000000 && mime_type) {
      const chatId = message.chat.id;
      
      console.log('Voice message received, processing with SpeechKit...');
      
      try {
        if (who.room === 'chat' && who.role === 'client') {
          const userId = await getUserIdByBusinessConnectionId(ctx?.businessConnectionId||'')||0;
          const recognized = await handleVoiceMessage(file_id, chatId, mime_type, userId, ctx);
          if (recognized?.recognizedText) {
            message = {...message, text: recognized?.recognizedText};
          }
        }
        
      } catch (voiceError) {
          console.error('Error processing voice message:', voiceError);
      }
    } else {
      console.log('TODO: async voice processing')
    }
  }

  if (message.location) {
      const address = await getAddressFromLocation(message.location.latitude, message.location.longitude);
      if (address) {
          message = {...message, text: `Клиент отправил адрес: ${address}`};
      }
  }
  try {
      const chatId = ctx.chat?.id;
      if (!chatId) {
          return;
      }

      const client = await getClient(chatId);
      const quickMode = client?.quickMode;
      await Promise.all([setClient({...ctx.from, quickMode} as Client), chatHandler(ctx, who, message, quickMode)]);
  } catch (error) {
      console.error('Error in chat:', JSON.stringify(error));
  }
}

async function initializeChat(bot: Bot<Context, Api<RawApi>>) {
  // Обработчик диалога пользователя с клиентом
bot.on('business_message', async (ctx, next) => {
  console.log('business_message.Received message:', JSON.stringify(ctx));

  const businessConnectionId = ctx.businessConnectionId;
  const businessMessage = ctx.businessMessage;
  const fromId = businessMessage.from?.id;

  let who: Who;
  if (!businessConnectionId) {
    console.error('!businessConnectionId');
    await next();
    return;
  } else if (fromId === ctx.chat?.id) {
    who = {room:'chat', role:'client', isBot:false};
  } else {
    who = {room:'chat', role:'user', isBot:false};
  }
  console.log('who, businessConnectionId:', who, businessConnectionId);

  

  switch (who.role) {
    case 'client':
        await chat(ctx, who, businessMessage);
      break;
    case 'user':
      if (fromId) {
        if((await getMode(fromId)) === 'activation'
          && (businessMessage?.chat?.username === 'realtoririnapetrova' || businessMessage?.chat?.username === 'petrovpaveld')
          && !who.isBot) {
            
          await updateUserBusinessConnection(fromId, businessConnectionId);

          const responseText = `Ваш бизнес аккаунт связан с панелью администратора, теперь можете настроить бота, теперь ваши клиенты никуда не денутся от вас`;

          await Promise.all([bot.api.sendMessage(fromId, responseText), setMode(fromId, 'idle')]);
          } else {
            // если пользователь сам отвечает клиенту
            await addChatMessage(
                businessMessage.chat.id,
                businessMessage.message_id,
                businessConnectionId,
                businessMessage.text || '',
                who,
                { status: true, retry: 0, lastRetryAt: new Date().toISOString() },
                businessMessage.reply_to_message?.text || '',
            );
            const messageIds = await getUnansweredMessageIds(businessMessage.chat.id, businessConnectionId);
            if (messageIds.length > 0) {
                await changeAnsweredStatus(businessMessage.chat.id, businessConnectionId, messageIds, true);
            }
        }
      }
      break;
    default:
      await next();
       break;
  }
});

// Обработчик для админки с ботом
bot.on('message', async (ctx, next) => {
  console.log('message.Received message:', JSON.stringify(ctx));
  const userId = ctx.from?.id;
  const mode: UserMode = userId ? await getMode(userId) : 'none';
  let who: Who = {room:'bot', role:mode==='demo'? 'client' : 'user', isBot: false};

  console.log('who, userId, mode:', who, userId, mode);
  switch (who.role) {
    case 'client':
      await chat(ctx, who, ctx.message);
      break;
    default:
    case 'user':
      await bot.api.sendMessage(userId, '❌ Общаться с ботом можно только в демо режиме, выполните команду /demo.');
      break;
  }
  await next();
});

bot.on('edited_message', async (ctx: Context) => {
    const editedMsg = ctx.editedMessage;
    const chatId = editedMsg?.chat.id;
    const messageId = editedMsg?.message_id;
    const newText = editedMsg?.text;
    const businessConnectionId = ctx.businessConnectionId || ctx.message?.business_connection_id;

    if (newText && chatId && messageId) {
        await updateChatMessage(chatId, messageId, businessConnectionId || '', newText);
    }
});
}


let dbDriver: Driver | undefined;

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