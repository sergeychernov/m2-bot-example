import { Bot, Context } from 'grammy';
import { createQuiz, QuizConfig } from './quiz';
import {deleteQuizState, getLatestPromptByType, setMode} from './ydb';

let quiz: any = null;

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
        const userId = ctx.from.id.toString();
        if (quiz && quiz.deleteQuizState) {
            await quiz.deleteQuizState(userId);
        } else {
            await deleteQuizState(userId);
        }
        if (quiz && quiz.quizStates) {
            delete quiz.quizStates[userId];
        }
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

export async function loadQuizConfigFromDb(): Promise<QuizConfig | null> {
    try {
        const prompt = await getLatestPromptByType('base');
        if (!prompt || !prompt.quizConfig) {
            console.warn('Quiz config not found in database!');
            return null;
        }
        return prompt.quizConfig;
    } catch (error) {
        console.error('Failed to load quiz config from DB:', JSON.stringify(error));
        return null;
    }
}

export { ensureQuiz, quiz };