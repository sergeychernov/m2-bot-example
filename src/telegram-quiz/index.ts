import { Bot, Context, InlineKeyboard } from 'grammy';
import { Callbacks, QuizConfig, QuizState, Storage, QuizQuestion } from './types';
import { memoryStorage } from './storage-memory';
import { validateAnswer } from './validation';
import { withCheckmark } from './utils';

type CreateTelegramQuizOptions = {
    bot: Bot;
    config: QuizConfig;
    storage?: Storage;
    callbacks?: Callbacks;
    parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown';
    namespace?: string;
};

export function createTelegramQuiz(opts: CreateTelegramQuizOptions) {
    const {
        bot,
        config,
        storage = memoryStorage,
        callbacks,
        parseMode,
        namespace = 'quiz'
    } = opts;

    // Константы для callback-данных
    const BTN_PREFIX = `tq_${namespace}_btn_`;
    const MULTI_PREFIX = `tq_${namespace}_multi_`;
    const MULTI_DONE = `tq_${namespace}_done_`;
    const EXIT = `tq_${namespace}_exit`;

    // ========== Вспомогательные функции ==========
    async function getState(userId: number): Promise<QuizState> {
        return (await storage.load(userId)) ?? {
            step: 0,
            answers: {},
            allowExit: false,
            context: {}
        };
    }

    async function saveState(userId: number, state: QuizState): Promise<void> {
        await storage.save(userId, state);
    }

    async function deleteState(userId: number): Promise<void> {
        await storage.delete(userId);
    }

    // ========== Основные публичные методы ==========
    async function start(
        userId: number,
        options?: { allowExit?: boolean; context?: Record<string, unknown> }
    ): Promise<void> {
        const state: QuizState = {
            step: 0,
            answers: {},
            allowExit: !!options?.allowExit,
            context: options?.context || {}
        };

        await saveState(userId, state);

        if (config.quizDescription) {
            await bot.api.sendMessage(userId, config.quizDescription, {
                parse_mode: parseMode
            });
        }

        await sendQuestion(userId, state);
    }

    async function handleText(ctx: Context): Promise<void> {
        const userId = ctx.from?.id;
        const text = ctx.message?.text;
        if (!userId || !text) return;

        const state = await getState(userId);
        const q = config.questions[state.step];
        if (!q || q.type !== 'text') {
            await ctx.reply('Пожалуйста, используйте кнопки.', {
                parse_mode: parseMode
            });
            return;
        }

        // Валидация ответа
        const validation = validateAnswer(text, q.validation);
        if (!validation.isValid) {
            await ctx.reply(validation.errorMessage || 'Ответ не прошёл проверку', {
                parse_mode: parseMode
            });
            return;
        }

        // Дополнительная кастомная валидация
        if (q.validation?.type === 'custom' && callbacks?.validateCustom) {
            const customValidation = await callbacks.validateCustom(ctx, {
                question: q,
                input: text,
                state
            });

            if (!customValidation.isValid) {
                await ctx.reply(customValidation.errorMessage || 'Ответ не прошёл проверку', {
                    parse_mode: parseMode
                });
                return;
            }
        }

        // Сохранение ответа
        state.answers[q.id] = text;
        if (callbacks?.onAnswer) {
            await callbacks.onAnswer(ctx, {
                question: q,
                answer: text,
                state
            });
        }

        // Переход к следующему вопросу
        state.step += 1;
        await saveState(userId, state);

        if (state.step < config.questions.length) {
            await sendQuestion(userId, state);
        } else {
            await completeQuiz(ctx, userId, state);
        }
    }

    async function handleCallback(ctx: Context): Promise<void> {
        const data = ctx.callbackQuery?.data;
        const userId = ctx.from?.id;
        if (!data || !userId) return;

        // Выход из квиза
        if (data === EXIT) {
            await exit(ctx);
            return;
        }

        const state = await getState(userId);
        const q = config.questions[state.step];
        if (!q) return;

        // Обработка разных типов вопросов
        if (data.startsWith(BTN_PREFIX)) {
            await handleButtonQuestion(ctx, data, state, q);
        }
        else if (data.startsWith(MULTI_PREFIX) || data.startsWith(MULTI_DONE)) {
            await handleMultiSelectQuestion(ctx, data, state, q);
        }
    }

    async function exit(ctx: Context): Promise<void> {
        const userId = ctx.from?.id;
        if (!userId) return;

        const state = await getState(userId);
        if (state && callbacks?.onExit) {
            await callbacks.onExit(ctx, { state });
        }

        await deleteState(userId);
        await ctx.reply(config.exitText || 'Вы вышли из квиза.');
    }

    async function reset(userId: number): Promise<void> {
        await deleteState(userId);
    }

    // ========== Приватные вспомогательные методы ==========
    async function sendQuestion(userId: number, state: QuizState): Promise<void> {
        const q = config.questions[state.step];
        if (!q) return;

        const messageOptions: any = {};
        if (parseMode) messageOptions.parse_mode = parseMode;

        switch (q.type) {
            case 'buttons':
                messageOptions.reply_markup = buildButtonsKeyboard(
                    q.options ?? [],
                    q.id,
                    state.allowExit
                );
                await bot.api.sendMessage(userId, q.question, messageOptions);
                break;

            case 'multi-select':
                const selected = Array.isArray(state.answers[q.id])
                    ? state.answers[q.id]
                    : [];

                messageOptions.reply_markup = buildMultiKeyboard(
                    q.options ?? [],
                    q.id,
                    selected,
                    state.allowExit
                );

                const text = selected.length
                    ? `${q.question}\n\nВыбрано: ${selected.join(', ')}`
                    : q.question;

                await bot.api.sendMessage(userId, text, messageOptions);
                break;

            default:
                if (state.allowExit) {
                    messageOptions.reply_markup = new InlineKeyboard()
                        .text(config.buttonLabels?.exit || 'Выйти', EXIT);
                }
                await bot.api.sendMessage(userId, q.question, messageOptions);
        }
    }

    function buildButtonsKeyboard(
        options: string[],
        qid: string,
        allowExit: boolean
    ): InlineKeyboard {
        const kb = new InlineKeyboard();

        options.forEach((label, idx) => {
            kb.text(label, `${BTN_PREFIX}${qid}_${idx}`);
            if ((idx + 1) % 2 === 0) kb.row();
        });

        if (allowExit) {
            kb.row().text(config.buttonLabels?.exit || 'Выйти', EXIT);
        }

        return kb;
    }

    function buildMultiKeyboard(
        options: string[],
        qid: string,
        selected: string[],
        allowExit: boolean
    ): InlineKeyboard {
        const kb = new InlineKeyboard();

        options.forEach((label, idx) => {
            const isSelected = selected.includes(label);
            kb.text(withCheckmark(isSelected, label), `${MULTI_PREFIX}${qid}_${idx}`);
            if ((idx + 1) % 2 === 0) kb.row();
        });

        kb.row().text(config.buttonLabels?.next || '➡️ Готово', `${MULTI_DONE}${qid}`);

        if (allowExit) {
            kb.text(config.buttonLabels?.exit || 'Выйти', EXIT);
        }

        return kb;
    }

    async function handleButtonQuestion(
        ctx: Context,
        data: string,
        state: QuizState,
        q: QuizQuestion
    ): Promise<void> {
        const userId = ctx.from?.id;
        if (!userId || q.type !== 'buttons') return;

        const payload = data.slice(BTN_PREFIX.length);
        const [qid, idxStr] = payload.split('_');

        if (qid !== q.id) return;

        const idx = Number(idxStr);
        const selectedValue = q.options?.[idx];
        if (selectedValue === undefined) return;

        // Сохранение ответа
        state.answers[q.id] = selectedValue;
        if (callbacks?.onAnswer) {
            await callbacks.onAnswer(ctx, {
                question: q,
                answer: selectedValue,
                state
            });
        }

        // Переход к следующему вопросу
        state.step += 1;
        await saveState(userId, state);

        await ctx.answerCallbackQuery();
        await ctx.editMessageReplyMarkup(undefined);

        if (state.step < config.questions.length) {
            await sendQuestion(userId, state);
        } else {
            await completeQuiz(ctx, userId, state);
        }
    }

    async function handleMultiSelectQuestion(
        ctx: Context,
        data: string,
        state: QuizState,
        q: QuizQuestion
    ): Promise<void> {
        const userId = ctx.from?.id;
        if (!userId || q.type !== 'multi-select') return;

        // Сразу отвечаем на callback, чтобы Telegram знал, что запрос обработан
        await ctx.answerCallbackQuery().catch(() => {});

        // Выбор/отмена варианта
        if (data.startsWith(MULTI_PREFIX)) {
            const payload = data.slice(MULTI_PREFIX.length);
            const [qid, idxStr] = payload.split('_');

            if (qid !== q.id) return;

            const idx = Number(idxStr);
            const option = q.options?.[idx];
            if (option === undefined) return;

            // Обновление выбранных вариантов
            const selected = Array.isArray(state.answers[q.id])
                ? state.answers[q.id]
                : [];

            state.answers[q.id] = selected.includes(option)
                ? selected.filter((v: string) => v !== option)
                : [...selected, option];

            await saveState(userId, state);

            // Обновление сообщения
            const updatedKb = buildMultiKeyboard(
                q.options ?? [],
                q.id,
                state.answers[q.id],
                state.allowExit
            );

            const updatedText = state.answers[q.id].length
                ? `${q.question}\n\nВыбрано: ${state.answers[q.id].join(', ')}`
                : q.question;

            try {
                // Единое обновление сообщения (текст + клавиатура)
                await ctx.editMessageText(updatedText, {
                    reply_markup: updatedKb,
                    ...(parseMode && { parse_mode: parseMode })
                });
            } catch (error) {
                console.error('Error updating message:', error);
            }
            return;
        }

        // Нажатие "Готово"
        if (data.startsWith(MULTI_DONE)) {
            const qid = data.slice(MULTI_DONE.length);
            if (qid !== q.id) return;

            const selected = Array.isArray(state.answers[q.id])
                ? state.answers[q.id]
                : [];

            // Проверка обязательного выбора
            if (q.required && selected.length === 0) {
                await ctx.answerCallbackQuery({
                    text: 'Выберите хотя бы один вариант'
                });
                return;
            }

            // Коллбэк ответа
            if (callbacks?.onAnswer) {
                await callbacks.onAnswer(ctx, {
                    question: q,
                    answer: selected,
                    state
                });
            }

            // Переход к следующему вопросу
            state.step += 1;
            await saveState(userId, state);

            await ctx.answerCallbackQuery();
            await ctx.editMessageReplyMarkup(undefined);

            if (state.step < config.questions.length) {
                await sendQuestion(userId, state);
            } else {
                await completeQuiz(ctx, userId, state);
            }
        }
    }

    async function completeQuiz(
        ctx: Context,
        userId: number,
        state: QuizState
    ): Promise<void> {
        if (config.successText) {
            await ctx.editMessageText(config.successText, {
                ...(parseMode && { parse_mode: parseMode })
            });
        }

        if (callbacks?.onComplete) {
            await callbacks.onComplete(ctx, {
                answers: state.answers,
                state
            });
        }

        await deleteState(userId);
    }

    return {
        start,
        handleText,
        handleCallback,
        exit,
        reset,
        patterns: { BTN_PREFIX, MULTI_PREFIX, MULTI_DONE, EXIT }
    };
}

export type { QuizQuestion, QuizConfig, QuizState, Storage, Callbacks } from './types';
export { memoryStorage } from './storage-memory';