import {Bot, Context, InlineKeyboard} from 'grammy';
import { addBotClientData, getBotClientData, saveQuizState, loadQuizState, deleteQuizState, setMode, getMode } from './ydb';

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
  const quizStates: Record<string, { step: number; answers: Record<string, any>; allowExit: boolean }> = {};
  const { questions, quizDescription, exitText, successText, buttonLabels } = quizConfig;

  async function saveUserFromState(ctx: Context, state: { answers: Record<string, any> }) {
    if (ctx.from) {
      const userId = ctx.from.id.toString();
      const oldData = await getBotClientData(userId) || { profile: {} };
      const newData: Record<string, any> = { ...oldData.profile };
      for (const question of quizConfig.questions) {
        if (state.answers[question.id]) {
          newData[question.key] = state.answers[question.id];
        }
      }
      try {
        const mode = await getMode(userId) || 'none';
        await addBotClientData(userId, newData, mode);
      } catch (e) {
        console.log('Данные не удалось сохранить', e);
      }
    }
  }

  async function startQuiz(ctx: Context, allowExit = false) {
    if (!ctx.chat || !ctx.from) return;
    const userId = ctx.from.id.toString();

    let state = await loadQuizState(userId);
    if (state) {
      quizStates[userId] = { ...state };
    } else {
      quizStates[userId] = { step: 0, answers: {}, allowExit };
      await saveQuizState(userId, 0, {}, allowExit);
    }
    if (quizDescription) {
      await ctx.reply(quizDescription);
    }
    await sendQuestion(ctx, quizStates[userId]);
  }

  function generateMultiSelectKeyboard(options: string[], selected: string[]): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const option of options) {
      keyboard.text(
        `${selected.includes(option) ? "✅" : "  "} ${option}`,
        `multi_${option}`
      ).row();
    }
    keyboard.text("➡️ Готово", "multi_done");
    return keyboard;
  }

  async function sendQuestion(ctx: Context, state: { step: number; answers: Record<string, any>; allowExit: boolean }) {
    const currentQ = questions[state.step];
    if (!currentQ) return;
    let keyboard: InlineKeyboard | undefined = undefined;

    if (currentQ.type === 'buttons') {
      keyboard = new InlineKeyboard();
      currentQ.options?.forEach((option: string) => keyboard!.text(option, `simple_quiz_${option}`).row());
    }
    if (currentQ.type === 'multi-select') {
      const selected: string[] = Array.isArray(state.answers[currentQ.id]) ? state.answers[currentQ.id] as string[] : [];
      keyboard = generateMultiSelectKeyboard(currentQ.options || [], selected);
    }
    if (state.allowExit && buttonLabels?.exit) {
      (keyboard ??= new InlineKeyboard()).text(buttonLabels.exit, 'exit_quiz').row();
    }
    const messageOptions = {
      reply_markup: keyboard?.inline_keyboard.length ? keyboard : undefined,
      parse_mode: 'HTML' as const
    };
    if (currentQ.imageUrl) {
      await ctx.replyWithPhoto(currentQ.imageUrl, {
        caption: currentQ.question,
        ...messageOptions,
      });
    } else {
      await ctx.reply(currentQ.question, messageOptions);
    }
  }

  async function handleQuizText(ctx: Context) {
    if (!ctx.chat || !ctx.message || typeof ctx.message.text !== 'string') return;
    const userId = ctx.from?.id.toString();

    if (!userId) {
      return;
    }

    let state = await ensureQuizState(ctx, quizStates, loadQuizState);
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
        await sendQuestion(ctx, state);
      } else {
        await showQuizResult(ctx, state.answers);
        await deleteQuizState(userId);
        delete quizStates[userId];
      }
    } else if (currentQ.type === 'buttons' || currentQ.type === 'multi-select') {
      await ctx.reply('Пожалуйста, выберите ответ из предложенных вариантов с помощью кнопок.');
    }
  }

  async function handleQuizButton(ctx: Context) {
    if (!ctx.chat || !ctx.match) return;
    const userId = ctx.from?.id.toString();
    if (!userId) {
      return;
    }

    let state = await ensureQuizState(ctx, quizStates, loadQuizState);
    if (!state) return;

    const currentQ = questions[state.step];
    if (currentQ.type === 'buttons') {
      state.answers[currentQ.id] = ctx.match[1];
      state.step += 1;
      await saveUserFromState(ctx, state);
      await saveQuizState(userId, state.step, state.answers, state.allowExit);
      await ctx.answerCallbackQuery();
      if (state.step < questions.length) {
        await sendQuestion(ctx, state);
      } else {
        await showQuizResult(ctx, state.answers);
        await deleteQuizState(userId);
        delete quizStates[userId];
      }
    }
  }

  async function handleQuizExit(ctx: Context) {
    if (!ctx.chat) return;
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      return;
    }
    delete quizStates[userId];
    await ctx.answerCallbackQuery();
    if (exitText) {
      await setMode(userId, 'none');
      await ctx.reply(exitText);
    }
    await deleteQuizState(userId);
  }

  async function handleMultiSelect(ctx: Context) {
    if (!ctx.chat || !ctx.callbackQuery) return;
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    let state = await ensureQuizState(ctx, quizStates, loadQuizState);
    if (!state) return;

    const currentQ = questions[state.step];
    if (currentQ.type !== 'multi-select') return;

    const data = ctx.callbackQuery.data;
    if (!data) return;
    let selected: string[] = Array.isArray(state.answers[currentQ.id]) ? state.answers[currentQ.id] as string[] : [];

    if (data === 'multi_done') {
      if (selected.length === 0) {
        await ctx.answerCallbackQuery({ text: "Выберите хотя бы один вариант!" });
        return;
      }
      state.step += 1;
      await saveUserFromState(ctx, state);
      await saveQuizState(userId, state.step, state.answers, state.allowExit);
      await ctx.answerCallbackQuery();
      if (state.step < questions.length) {
        await sendQuestion(ctx, state);
      } else {
        await showQuizResult(ctx, state.answers);
        await deleteQuizState(userId);
        delete quizStates[userId];
      }
      return;
    }

    if (data.startsWith('multi_')) {
      const option = data.slice('multi_'.length);
      if (selected.includes(option)) {
        selected = selected.filter(o => o !== option);
      } else {
        selected.push(option);
      }
      state.answers[currentQ.id] = [...selected];
      await saveQuizState(userId, state.step, state.answers, state.allowExit);
      await ctx.api.editMessageReplyMarkup(
        ctx.chat.id,
        ctx.callbackQuery.message!.message_id,
        { reply_markup: generateMultiSelectKeyboard(currentQ.options || [], selected) }
      );
      await ctx.answerCallbackQuery();
    }
  }

  async function showQuizResult(ctx: Context, answers: Record<string, any>) {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      return;
    }
    await setMode(userId, 'none');
    // временно для тестирования
    let result = 'Ваши ответы:\n';
    for (const q of questions) {
      const val = answers[q.id];
      if (Array.isArray(val)) {
        result += `${q.key} — ${val.join(', ')}\n`;
      } else {
        result += `${q.key} — ${val || ''}\n`;
      }
    }
    if (successText) {
      await ctx.reply(successText);
    }
    await ctx.reply(result);
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
    quizStates: Record<string, { step: number; answers: Record<string, any>; allowExit: boolean }>,
    loadQuizState: (userId: string) => Promise<{ step: number; answers: Record<string, any>; allowExit: boolean } | null>
): Promise<{ step: number; answers: Record<string, any>; allowExit: boolean } | null> {
  const userId = ctx.from?.id?.toString();
  if (!userId) return null;

  let state = quizStates[userId];
  if (!state) {
    const dbState = await loadQuizState(userId);
    if (dbState) {
      state = { ...dbState };
      quizStates[userId] = state;
    } else {
      await ctx.reply('Не удалось восстановить состояние квиза. Начните квиз заново командой /quiz.');
      return null;
    }
  }
  return state;
}