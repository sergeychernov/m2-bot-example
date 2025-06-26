import { Bot, Context } from 'grammy';
import { createQuiz, QuizConfig } from './quiz';
import { deleteQuizState, getMode, getQuizConfig, setMode } from './ydb';
import { bot } from './bot-instance';

let quiz: ReturnType<typeof createQuiz> | null = null;

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
            if (!await ensureQuiz(ctx)) return;
            await quiz?.handleQuizText(ctx);
            return;
        }
        return next();
    });

    bot.callbackQuery(/simple_quiz_(.+)/, async (ctx) => {
        if (!await ensureQuiz(ctx)) return;
        quiz?.handleQuizButton(ctx);
    });

    bot.callbackQuery(/^multi_/, async (ctx) => {
        if (!await ensureQuiz(ctx)) return;
        await quiz?.handleMultiSelect(ctx);
    });

    bot.callbackQuery('exit_quiz', async (ctx) => {
        if (!await ensureQuiz(ctx)) return;
        quiz?.handleQuizExit(ctx);
    });
}

async function ensureQuiz(ctx: Context): Promise<boolean> {
    if (!quiz) {
        const quizConfig = await loadQuizConfigFromDb();
        if (quizConfig) {
            quiz = createQuiz(quizConfig);
        } else {
            await ctx.reply('Ошибка: не удалось загрузить квиз.');
            return false;
        }
    }
    return true;
}

export async function resetQuizStateForUser(ctx: Context) {
    if (ctx.from) {
        const userId = ctx.from.id;
        // Используем импортированную функцию deleteQuizState напрямую
        await deleteQuizState(userId);
        // quizStates - это внутреннее состояние createQuiz, к нему нет доступа извне
        // Поэтому просто удаляем состояние из базы данных
    }
}

export async function startQuizWithFreshConfig(ctx: any, allowExit = false) {
    try {
        const quizConfig = await loadQuizConfigFromDb();
        if (!quizConfig) {
            await ctx.reply('❌ Квиз не настроен');
            return;
        }
        quiz = createQuiz(quizConfig);
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
        quiz = createQuiz(quizConfig);
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