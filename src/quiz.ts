import {Bot, Context, InlineKeyboard} from 'grammy';
import { addBotClientData, getBotClientData, saveQuizState, loadQuizState, deleteQuizState } from './ydb';

export type QuizQuestion = {
  id: string;
  key: string;
  question: string;
  type: 'text' | 'buttons';
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
  const quizStates: Record<string, { step: number; answers: Record<string, string>; allowExit: boolean }> = {};
  const { questions, quizDescription, exitText, successText, buttonLabels } = quizConfig;

  async function saveUserFromState(ctx: Context, state: { answers: Record<string, string> }) {
    if (ctx.from) {
      const userId = ctx.from.id.toString();
      const oldData = await getBotClientData(userId) || {};
      
      const newData: Record<string, any> = { ...oldData };
      for (const question of quizConfig.questions) {
        if (state.answers[question.id]) {
          newData[question.key] = state.answers[question.id];
        }
      }

      try {
        await addBotClientData(userId, newData);
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
      const userData = await getBotClientData(userId);
      const oldAnswers: Record<string, string> = {};
      if (userData) {
        for (const question of questions) {
          if (userData[question.key]) {
            oldAnswers[question.id] = userData[question.key];
          }
        }
      }
      quizStates[userId] = { step: 0, answers: { ...oldAnswers }, allowExit };
      await saveQuizState(userId, 0, { ...oldAnswers }, allowExit);
    }
    if (quizDescription) {
      await ctx.reply(quizDescription);
    }
    await sendQuestion(ctx, quizStates[userId]);
  }

  async function sendQuestion(ctx: Context, state: { step: number; answers: Record<string, string>; allowExit: boolean }) {
    const currentQ = questions[state.step];
    if (!currentQ) return;
    const keyboard = new InlineKeyboard();
    if (currentQ.type === 'buttons') {
      currentQ.options?.forEach((option: string) => keyboard.text(option, `simple_quiz_${option}`).row());
    }
    if (state.allowExit && buttonLabels?.exit) {
      keyboard.text(buttonLabels.exit, 'exit_quiz').row();
    }
    const messageOptions = {
      reply_markup: keyboard.inline_keyboard.length > 0 ? keyboard : undefined,
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
    } else if (currentQ.type === 'buttons') {
      await ctx.reply('Пожалуйста, выберите один из предложенных вариантов с помощью кнопок.');
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
    if (userId) {
      await deleteQuizState(userId);
    }
    if (exitText) {
      await ctx.reply(exitText);
    }
  }

  async function showQuizResult(ctx: Context, answers: Record<string, string>) {
    // временно для тестирования
    let result = 'Ваши ответы:\n';
    for (const q of questions) {
      result += `${q.key} — ${answers[q.id] || ''}\n`;
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
    quizStates: Record<string, { step: number; answers: Record<string, string>; allowExit: boolean }>,
    loadQuizState: (userId: string) => Promise<{ step: number; answers: Record<string, string>; allowExit: boolean } | null>
): Promise<{ step: number; answers: Record<string, string>; allowExit: boolean } | null> {
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