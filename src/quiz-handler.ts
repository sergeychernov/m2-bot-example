import {Bot, Context} from 'grammy';
import {QuizCallbacks, QuizConfig, Quiz} from './quiz';
import {deleteQuizProgress, getMode, getQuizConfig, loadQuizProgress, saveQuizProgress, setMode} from './ydb';
import {addUserData, getUserDataByUserId} from "./users";

const createQuizCallbacks = (quizConfig: QuizConfig): QuizCallbacks => ({
    loadQuizStep: async (userId: number) => loadQuizProgress(userId),
    saveQuizStep: async (userId: number, step: number) => saveQuizProgress(userId, step),
    onQuizStart: (userId) => {
        console.log(`Quiz started for ${userId}`);
        return setMode(userId, 'quiz');
    },
    onQuizAnswer: async (userId, questionId, answer) => {
        const user = await getUserDataByUserId(userId);
        const question = quizConfig.questions.find(q => q.id === questionId);
        if (!question) return;

        await addUserData(
            { id: userId } as any,
            { ...user?.profile, [question.key]: answer },
            await getMode(userId) || 'none'
        );
        console.log('EEEEEEEEE');
    },
    onQuizEnd: async (userId) => {
        await setMode(userId, 'none');
        await deleteQuizProgress(userId);
    }
});


export function initializeQuiz(bot: Bot) {
    bot.command('quiz', async (ctx) => {
        await resetQuizStateForUser(ctx);
        const userId = ctx.from?.id;
        if (!userId) {
            return;
        }
        await setMode(userId, 'quiz');
        if (typeof ctx.from?.id === 'number') {
            await startQuizWithFreshConfig(ctx, true);
        }
    });

    bot.on('message:text', async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) return next();

        const mode = await getMode(userId);
        if (mode === 'quiz') {
            const quiz = await ensureQuiz(ctx);
            if (quiz) {
                await quiz.handleTextAnswer();
                return;
            }
        }

        await next();
    });

    bot.callbackQuery(/^quiz_/, async (ctx) => {
        const quizConfig = await loadQuizConfigFromDb();
        if (!quizConfig) {
            return;
        }

        const quiz = await ensureQuiz(ctx);

        if (!quiz) {
            return;
        }
        const action = ctx.callbackQuery.data?.split('_')[1];

        switch (action) {
            case 'button':
                await quiz.handleButtonAction();
                break;
            case 'multi':
                await quiz.handleMultiSelectAction();
                break;
            case 'exit':
                await quiz.handleExitAction();
                break;
        }
    });
}

async function ensureQuiz(ctx: Context) {
    const quizConfig = await loadQuizConfigFromDb();
    const userId = ctx.from?.id;

    if (quizConfig && userId) {
        const quizCallbacks = createQuizCallbacks(quizConfig);
        return new Quiz(quizConfig, quizCallbacks, ctx);
    } else {
        await ctx.reply('Ошибка: не удалось загрузить квиз.');
        return null;
    }
}

export async function resetQuizStateForUser(ctx: Context) {
    if (ctx.from) {
        const userId = ctx.from.id;
        await deleteQuizProgress(userId);
    }
}

export async function startQuizWithFreshConfig(ctx: Context, allowExit: boolean = false): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
        console.error('Invalid userId provided');
        return;
    }

    try {
        const quizConfig = await loadQuizConfigFromDb();
        if (!quizConfig) {
            await ctx.reply('❌ Квиз не настроен');
            return;
        }

        const quizCallbacks = createQuizCallbacks(quizConfig);
        const quiz = new Quiz(quizConfig, quizCallbacks, ctx);
        await quiz.startQuiz();
    } catch (error) {
        console.error('Error starting quiz:', error);
        await ctx.reply('❌ Ошибка при запуске квиза');
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