import { Context, InlineKeyboard } from 'grammy';
import { saveQuizState, loadQuizState, deleteQuizState, setMode, getMode } from './ydb';
import { formatProfileMarkdownV2 } from './telegram-utils';
import { bot } from './bot-instance';
import { getUserDataByUserId, addUserData } from './users';

export type QuizQuestion = {
  id: string;
  key: string;
  question: string;
  type: 'text' | 'buttons' | 'multi-select';
  options?: string[];
  required?: boolean;
  imageUrl?: string;
  validation?: {
    type: 'email' | 'phone' | 'url' | 'number' | 'minLength' | 'maxLength' | 'pattern' | 'custom';
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    errorMessage?: string;
  };
};

export type QuizConfig = {
  quizDescription?: string;
  exitText?: string;
  successText?: string;
  buttonLabels?: {
    exit?: string;
  };
  questions: QuizQuestion[];
};

export function createQuiz(quizConfig: QuizConfig) {
  const { questions, quizDescription, exitText, successText, buttonLabels } = quizConfig;

  async function saveUserFromState(ctx: Context, state: { answers: Record<string, any> }) {
    if (ctx.from) {
      const userId = ctx.from.id
      const oldData = await getUserDataByUserId(userId) || { profile: {} };
      const newData: Record<string, any> = { ...oldData.profile };
      for (const question of quizConfig.questions) {
        if (state.answers[question.id]) {
          newData[question.key] = state.answers[question.id];
        }
      }
      try {
        const mode = await getMode(userId) || 'none';
        await addUserData(userId, newData, mode);
      } catch (e) {
        console.log('Данные не удалось сохранить', e);
      }
    }
  }

  async function startQuiz(userId: number, allowExit = false) {
    if (!userId) {
      return;
    }

    let state = await loadQuizState(userId);
    if (!state) {
      state = { step: 0, answers: {}, allowExit };
      await saveQuizState(userId, 0, {}, allowExit);
    }
    if (quizDescription) {
      await bot.api.sendMessage(userId, quizDescription);
    }
    await sendQuestion(userId, state);
  }

  async function sendQuestion(userId: number, state: { step: number; answers: Record<string, any>; allowExit: boolean }) {
    try {
      const currentQ = questions[state.step];
      if (!currentQ) return;
      let keyboard: InlineKeyboard | undefined = undefined;

      if (currentQ.type === 'buttons') {
        keyboard = new InlineKeyboard();
        currentQ.options?.forEach((option: string) => keyboard!.text(option, `simple_quiz_${currentQ.id}_${option}`).row());
      }
      if (currentQ.type === 'multi-select') {
        const selected: string[] = Array.isArray(state.answers[currentQ.id]) ? state.answers[currentQ.id] as string[] : [];
        keyboard = new InlineKeyboard();
        for (const option of currentQ.options || []) {
          keyboard.text(
            `${selected.includes(option) ? "✅" : "  "} ${option}`,
            `multi_${currentQ.id}_${option}`
          ).row();
        }
        keyboard.text("➡️ Готово", `multi_done_${currentQ.id}`);
      }
      if (state.allowExit && buttonLabels?.exit) {
        (keyboard ??= new InlineKeyboard()).text(buttonLabels.exit, 'exit_quiz').row();
      }
      const messageOptions = {
        reply_markup: keyboard?.inline_keyboard.length ? keyboard : undefined,
        parse_mode: 'HTML' as const
      };
      if (currentQ.imageUrl) {
        await bot.api.sendPhoto(userId, currentQ.imageUrl, {
          caption: currentQ.question,
          ...messageOptions,
        });
      } else {
        await bot.api.sendMessage(userId, currentQ.question, messageOptions);
      }
    } catch (e) {
      console.error('Ошибка в sendQuestion:', JSON.stringify(e));
    }
  }

  async function handleQuizText(ctx: Context) {
    try {
      if (!ctx.chat || !ctx.message || typeof ctx.message.text !== 'string') return;
      const userId = ctx.from?.id;

      if (!userId) {
        return;
      }

      let state = await ensureQuizState(ctx, loadQuizState);
      if (!state) return;

      const currentQ = questions[state.step];
      if (currentQ.type === 'text') {
        const validationResult = validateAnswer(ctx.message.text, currentQ.validation);
        if (!validationResult.isValid) {
          await ctx.reply(validationResult.errorMessage || 'Ответ не прошел валидацию');
          return;
        }
        state.answers[currentQ.id] = ctx.message.text;
        state.step += 1;
        await saveUserFromState(ctx, state);
        await saveQuizState(userId, state.step, state.answers, state.allowExit);
        if (state.step < questions.length) {
          await sendQuestion(ctx.from?.id, state);
        } else {
          await showQuizResult(ctx, state.answers);
          await deleteQuizState(userId);
        }
      } else if (currentQ.type === 'buttons' || currentQ.type === 'multi-select') {
        await ctx.reply('Пожалуйста, выберите ответ из предложенных вариантов с помощью кнопок.');
      }
    } catch (e) {
      console.error('Ошибка в handleQuizText:', e);
      try { await ctx.reply('Произошла ошибка при обработке вашего ответа.'); } catch { }
    }
  }

  async function handleQuizButton(ctx: Context) {
    try {
      if (!ctx.chat || !ctx.match) return;
      const userId = ctx.from?.id;
      if (!userId) {
        return;
      }

      let state = await ensureQuizState(ctx, loadQuizState);
      if (!state) return;

      const currentQ = questions[state.step];
      if (currentQ.type !== 'buttons') {
        await ctx.answerCallbackQuery();
        return;
      }
      const data = ctx.callbackQuery?.data;
      if (!data) {
        await ctx.answerCallbackQuery();
        return;
      }
      const match = data.match(/^simple_quiz_(.+?)_(.+)$/);
      if (!match) {
        await ctx.answerCallbackQuery();
        return;
      }
      const questionId = match[1];
      const option = match[2];
      if (currentQ.id !== questionId) {
        await ctx.answerCallbackQuery();
        return;
      }
      state.answers[currentQ.id] = option;
      state.step += 1;
      await saveUserFromState(ctx, state);
      await saveQuizState(userId, state.step, state.answers, state.allowExit);
      await ctx.answerCallbackQuery();
      if (state.step < questions.length) {
        await sendQuestion(ctx.from?.id, state);
      } else {
        await showQuizResult(ctx, state.answers);
        await deleteQuizState(userId);
      }
    } catch (e) {
      console.error('Ошибка в handleQuizButton:', e);
      try { await ctx.reply('Произошла ошибка при обработке ответа на кнопку.'); } catch { }
    }
  }

  async function handleQuizExit(ctx: Context) {
    try {
      if (!ctx.chat) return;
      const userId = ctx.from?.id;
      if (!userId) {
        return;
      }
      await deleteQuizState(userId);
      if (exitText) {
        await setMode(userId, 'none');
        await ctx.reply(exitText);
      }
    } catch (e) {
      console.error('Ошибка в handleQuizExit:', e);
      try { await ctx.reply('Произошла ошибка при выходе из квиза.'); } catch { }
    }
  }

  async function handleMultiSelect(ctx: Context) {
    try {
      if (!ctx.chat || !ctx.callbackQuery) return;
      const userId = ctx.from?.id;
      if (!userId) return;

      let state = await ensureQuizState(ctx, loadQuizState);
      if (!state) return;

      const currentQ = questions[state.step];
      if (currentQ.type !== 'multi-select') {
        await ctx.answerCallbackQuery();
        return;
      }
      const data = ctx.callbackQuery.data;
      if (!data) return;
      const doneMatch = data.match(/^multi_done_(.+)$/);
      const selectMatch = data.match(/^multi_(.+?)_(.+)$/);
      if (doneMatch) {
        const questionId = doneMatch[1];
        if (currentQ.id !== questionId) {
          await ctx.answerCallbackQuery();
          return;
        }
        let selected: string[] = Array.isArray(state.answers[currentQ.id]) ? state.answers[currentQ.id] as string[] : [];
        if (selected.length === 0) {
          await ctx.answerCallbackQuery({ text: "Выберите хотя бы один вариант!" });
          return;
        }
        state.step += 1;
        await saveUserFromState(ctx, state);
        await saveQuizState(userId, state.step, state.answers, state.allowExit);
        await ctx.answerCallbackQuery();
        if (state.step < questions.length) {
          await sendQuestion(ctx.from?.id, state);
        } else {
          await showQuizResult(ctx, state.answers);
          await deleteQuizState(userId);
        }
        return;
      } else if (selectMatch) {
        const questionId = selectMatch[1];
        const option = selectMatch[2];
        if (currentQ.id !== questionId) {
          await ctx.answerCallbackQuery();
          return;
        }
        let selected: string[] = Array.isArray(state.answers[currentQ.id]) ? state.answers[currentQ.id] as string[] : [];
        if (selected.includes(option)) {
          selected = selected.filter(o => o !== option);
        } else {
          selected.push(option);
        }
        state.answers[currentQ.id] = [...selected];
        await saveQuizState(userId, state.step, state.answers, state.allowExit);
         const keyboard = new InlineKeyboard();
          for (const option of currentQ.options || []) {
            keyboard.text(
              `${selected.includes(option) ? "✅" : "  "} ${option}`,
              `multi_${currentQ.id}_${option}`
            ).row();
          }
        keyboard.text("➡️ Готово", `multi_done_${currentQ.id}`);
        await bot.api.editMessageReplyMarkup(
          ctx.chat.id,
          ctx.callbackQuery.message!.message_id,
          {
            reply_markup: keyboard?.inline_keyboard.length ? keyboard : undefined,
          }
        );
        await ctx.answerCallbackQuery();
      } else {
        await ctx.answerCallbackQuery();
      }
    } catch (e) {
      console.error('Ошибка в handleMultiSelect:', e);
      try { await ctx.reply('Произошла ошибка при выборе варианта.'); } catch { }
    }
  }

  async function showQuizResult(ctx: Context, answers: Record<string, any>) {
    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }
    await setMode(userId, 'idle');
    const profileForDisplay: Record<string, any> = {};
    for (const q of questions) {
      if (answers[q.id] !== undefined) {
        profileForDisplay[q.key] = answers[q.id];
      }
    }
    if (successText) {
      await ctx.reply(successText);
    }

    const result = formatProfileMarkdownV2(profileForDisplay);
    try {
      await ctx.reply(result, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('Ошибка при отправке MarkdownV2:', e, 'Текст:', result);
    }
  }

  return {
    startQuiz,
    handleQuizText,
    handleQuizButton,
    handleQuizExit,
    handleMultiSelect,
  };
}

// Валидируем ответ пользователя
function validateAnswer(answer: string, validation?: QuizQuestion['validation']): { isValid: boolean; errorMessage?: string } {
  if (!validation) return { isValid: true };

  const { type, pattern, minLength, maxLength, min, max, errorMessage } = validation;

  switch (type) {
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(answer)) {
        return {
          isValid: false,
          errorMessage: errorMessage || 'Пожалуйста, введите корректный email адрес'
        };
      }
      break;

    case 'phone':
      const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
      if (!phoneRegex.test(answer)) {
        return {
          isValid: false,
          errorMessage: errorMessage || 'Пожалуйста, введите корректный номер телефона'
        };
      }
      break;

    case 'url':
      try {
        new URL(answer);
      } catch {
        return {
          isValid: false,
          errorMessage: errorMessage || 'Пожалуйста, введите корректный URL'
        };
      }
      break;

    case 'number':
      const num = parseFloat(answer);
      if (isNaN(num)) {
        return {
          isValid: false,
          errorMessage: errorMessage || 'Пожалуйста, введите число'
        };
      }
      if (min !== undefined && num < min) {
        return {
          isValid: false,
          errorMessage: errorMessage || `Число должно быть не меньше ${min}`
        };
      }
      if (max !== undefined && num > max) {
        return {
          isValid: false,
          errorMessage: errorMessage || `Число должно быть не больше ${max}`
        };
      }
      break;

    case 'minLength':
      if (minLength !== undefined && answer.length < minLength) {
        return {
          isValid: false,
          errorMessage: errorMessage || `Ответ должен содержать минимум ${minLength} символов`
        };
      }
      break;

    case 'maxLength':
      if (maxLength !== undefined && answer.length > maxLength) {
        return {
          isValid: false,
          errorMessage: errorMessage || `Ответ должен содержать максимум ${maxLength} символов`
        };
      }
      break;

    case 'pattern':
      if (pattern) {
        const regex = new RegExp(pattern);
        if (!regex.test(answer)) {
          return {
            isValid: false,
            errorMessage: errorMessage || 'Ответ не соответствует требуемому формату'
          };
        }
      }
      break;
  }

  return { isValid: true };
}

// чтобы продолжать квиз после паузы
async function ensureQuizState(
  ctx: Context,
  loadQuizState: (userId: number) => Promise<{ step: number; answers: Record<string, any>; allowExit: boolean } | null>
): Promise<{ step: number; answers: Record<string, any>; allowExit: boolean } | null> {
  const userId = ctx.from?.id;
  if (!userId) return null;

  let state = await loadQuizState(userId);
  if (!state) {
    await ctx.reply('Не удалось восстановить состояние квиза. Начните квиз заново командой /quiz.');
    return null;
  }
  return state;
}