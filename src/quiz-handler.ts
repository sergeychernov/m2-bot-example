import { Bot, Context } from 'grammy';
import { createTelegramQuiz } from './telegram-quiz';
import { ydbStorage, createYdbCallbacks } from './quiz-adapters';
import { deleteQuizState, getMode, getQuizConfig, setMode } from './ydb';
import { bot } from './bot-instance';

let quizInstance: ReturnType<typeof createTelegramQuiz> | null = null;

async function ensureQuizInstance() {
    if (!quizInstance) {
        console.log('Creating new quiz instance');
        const quizConfig = await loadQuizConfigFromDb();
        if (!quizConfig) {
            throw new Error('Quiz config not found');
        }
        
        console.log('Quiz config loaded, creating quiz instance');
        quizInstance = createTelegramQuiz({
            bot,
            config: quizConfig,
            storage: ydbStorage,
            callbacks: createYdbCallbacks(quizConfig),
            parseMode: 'HTML',
            namespace: 'main'
        });
        console.log('Quiz instance created successfully');
    } else {
        console.log('Using existing quiz instance');
    }
    return quizInstance;
}

export function initializeQuiz(bot: Bot) {
    bot.command('quiz', async (ctx) => {
        await resetQuizStateForUser(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        await setMode(userId, 'quiz');
        if (typeof ctx.from?.id === 'number') {
            await startQuizWithFreshConfig(ctx.from.id, true);
        }
    });

    bot.on('message:text', async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        const mode = await getMode(userId);
        if (mode === 'quiz') {
            try {
                const quiz = await ensureQuizInstance();
                await quiz.handleText(ctx);
            } catch (error) {
                console.error('Error handling quiz text:', error);
                await ctx.reply('Ошибка: не удалось загрузить квиз.');
            }
            return;
        }
        return next();
    });

    bot.callbackQuery(/^tq_main_/, async (ctx) => {
        console.log('Хеллоу');
        try {
            const quiz = await ensureQuizInstance();
            await quiz.handleCallback(ctx);
        } catch (error) {
            console.error('Error handling quiz callback:', error);
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
            await ctx.answerCallbackQuery({ text: 'Ошибка при обработке квиза' });
        }
    });
}

export async function resetQuizStateForUser(ctx: Context) {
    if (ctx.from) {
        const userId = ctx.from.id;
        await deleteQuizState(userId);
    }
}

export async function startQuizWithFreshConfig(userId: number, allowExit = false) {
    if (!userId || typeof userId !== 'number') {
        console.error('Invalid userId provided to startQuizWithFreshConfigForUser:', userId);
        return;
    }
    
    try {
        quizInstance = null;
        const quiz = await ensureQuizInstance();
        await quiz.start(userId, { allowExit });
    } catch (error) {
        console.error('Error starting quiz with fresh config for user:', JSON.stringify(error));
        await bot.api.sendMessage(userId, '❌ Ошибка при запуске квиза');
    }
}

export async function loadQuizConfigFromDb() {
    try {
        const config = await getQuizConfig();
        if (!config) {
            console.warn('Quiz config not found in quiz_configs table!');
            return null;
        }
        return config;
    } catch (error) {
        console.error('Failed to load quiz config from quiz_configs table:', JSON.stringify(error));
        return null;
    }
}