import { Bot, Context } from 'grammy';
import { createQuiz, QuizConfig } from './quiz';
import { deleteQuizState, getMode, getQuizConfig, setMode } from './ydb';
import { bot } from './bot-instance';

export function initializeQuiz(bot: Bot) {
    bot.command('quiz', async (ctx) => {
        await resetQuizStateForUser(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        await setMode(userId, 'quiz');
        await startQuizWithFreshConfig(ctx, true);
    });

    // bot.command('start', async (ctx) => {
    //     await resetQuizStateForUser(ctx);
    //     const userId = ctx.from?.id?.toString();
    //     if (!userId) {
    //         return;
    //     }
    //     await setMode(userId, 'quiz');
    //     await startQuizWithFreshConfig(ctx, false);
    // });

    bot.on('message:text', async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        const mode = await getMode(userId);
        if (mode === 'quiz') {
            const quiz = await ensureQuiz(ctx);
            if (!quiz) {
                return;
            }
            await quiz.handleQuizText(ctx);
            return;
        }
        return next();
    });

    bot.callbackQuery(/simple_quiz_(.+)/, async (ctx) => {
        const quiz = await ensureQuiz(ctx);
        if (!quiz) {
            return;
        }
        quiz.handleQuizButton(ctx);
    });

    bot.callbackQuery(/^multi_/, async (ctx) => {
        const quiz = await ensureQuiz(ctx);
        if (!quiz) {
            return;
        }
        await quiz.handleMultiSelect(ctx);
    });

    bot.callbackQuery('exit_quiz', async (ctx) => {
        const quiz = await ensureQuiz(ctx);
        if (!quiz) {
            return;
        }
        quiz.handleQuizExit(ctx);
    });
}

async function ensureQuiz(ctx: Context): Promise<ReturnType<typeof createQuiz> | null> {
    const quizConfig = await loadQuizConfigFromDb();
    if (quizConfig) {
        return createQuiz(quizConfig);
    } else {
        await ctx.reply('Ошибка: не удалось загрузить квиз.');
        return null;
    }
}

export async function resetQuizStateForUser(ctx: Context) {
    if (ctx.from) {
        const userId = ctx.from.id;
        await deleteQuizState(userId);
    }
}

export async function startQuizWithFreshConfig(ctx: any, allowExit = false) {
    try {
        const quizConfig = await loadQuizConfigFromDb();
        if (!quizConfig) {
            await ctx.reply('❌ Квиз не настроен');
            return;
        }
        const quiz = createQuiz(quizConfig);
        await quiz.startQuiz(ctx, allowExit);
    } catch (error) {
        console.error('Error starting quiz with fresh config:', error);
        await ctx.reply('❌ Ошибка при запуске квиза');
    }
}

export async function startQuizWithFreshConfigForUser(userId: number, allowExit = false) {
    if (!userId || typeof userId !== 'number') {
        console.error('Invalid userId provided to startQuizWithFreshConfigForUser:', userId);
        return;
    }
    
    try {
        const quizConfig = await loadQuizConfigFromDb();
        if (!quizConfig) {
            await bot.api.sendMessage(userId, '❌ Квиз не настроен');
            return;
        }
        const quiz = createQuiz(quizConfig);
        await quiz.startQuizForUser(userId, allowExit);
    } catch (error) {
        console.error('Error starting quiz with fresh config for user:', JSON.stringify(error));
        await bot.api.sendMessage(userId, '❌ Ошибка при запуске квиза');
    }
}

export async function loadQuizConfigFromDb(): Promise<QuizConfig | null> {
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