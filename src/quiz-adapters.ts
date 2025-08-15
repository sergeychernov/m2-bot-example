import { Storage, QuizState, Callbacks, QuizQuestion } from './telegram-quiz/types';
import { saveQuizState, loadQuizState, deleteQuizState, getMode, setMode } from './ydb';
import { getUserDataByUserId, addUserData } from './users';
import { formatProfileMarkdownV2 } from './telegram-utils';
import { Context } from 'grammy';

// Адаптер хранилища для YDB
export const ydbStorage: Storage = {
    async load(userId: number): Promise<QuizState | null> {
        try {
            const state = await loadQuizState(userId);
            if (!state) return null;
            
            return {
                step: state.step,
                answers: state.answers,
                allowExit: state.allowExit,
                context: {}
            };
        } catch (error) {
            console.error('Failed to load quiz state from YDB:', error);
            return null;
        }
    },

    async save(userId: number, state: QuizState): Promise<void> {
        try {
            await saveQuizState(userId, state.step, state.answers, state.allowExit);
        } catch (error) {
            console.error('Failed to save quiz state to YDB:', error);
            throw error;
        }
    },

    async delete(userId: number): Promise<void> {
        try {
            await deleteQuizState(userId);
        } catch (error) {
            console.error('Failed to delete quiz state from YDB:', error);
            throw error;
        }
    }
};

// Фабрика для создания колбэков с YDB интеграцией
export function createYdbCallbacks(quizConfig: { questions: QuizQuestion[] }): Callbacks {
    return {
        async onAnswer(ctx: Context, { question, answer, state }) {
            if (ctx.from) {
                const userId = ctx.from.id;
                const oldData = await getUserDataByUserId(userId) || { profile: {} };
                const newData: Record<string, any> = { ...oldData.profile };
                
                // Сохраняем ответ в профиль пользователя
                newData[question.key] = answer;
                
                try {
                    const mode = await getMode(userId) || 'none';
                    await addUserData(ctx.from, newData, mode);
                } catch (e) {
                    console.log('Данные не удалось сохранить', e);
                }
            }
        },

        async onComplete(ctx: Context, { answers, state }) {
            const userId = ctx.from?.id;
            if (!userId) return;

            await setMode(userId, 'idle');
            
            // Формируем профиль для отображения
            const profileForDisplay: Record<string, any> = {};
            for (const q of quizConfig.questions) {
                if (answers[q.id] !== undefined) {
                    profileForDisplay[q.key] = answers[q.id];
                }
            }

            // Отправляем результат в markdown формате
            const result = formatProfileMarkdownV2(profileForDisplay);
            try {
                await ctx.reply(result, { parse_mode: 'MarkdownV2' });
            } catch (e) {
                console.error('Ошибка при отправке MarkdownV2:', e, 'Текст:', result);
            }
        },

        async onExit(ctx: Context, { state }) {
            const userId = ctx.from?.id;
            if (!userId) return;
            
            await setMode(userId, 'none');
        }
    };
}

