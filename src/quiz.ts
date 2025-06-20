import { Context, InlineKeyboard } from 'grammy';
import { addUserData, getUserData } from './ydb';
import Ajv from 'ajv';
import quizSchema from './quiz-schema.json';

export function createQuiz(questions: any[]) {
  const ajv = new Ajv();
  const validate = ajv.compile(quizSchema);
  if (!validate(questions)) {
    throw new Error('Вопросы не прошли валидацию: ' + JSON.stringify(validate.errors));
  }

  const quizStates: Record<string, { step: number; answers: Record<string, string>; allowExit: boolean }> = {};

  async function saveUserFromState(ctx: Context, state: { answers: Record<string, string> }) {
    if (ctx.from) {
      const userId = ctx.from.id.toString();
      const oldData = await getUserData(userId) || {};
      
      const newData: Record<string, any> = { ...oldData };
      for (const question of questions) {
        if (state.answers[question.id]) {
          newData[question.key] = state.answers[question.id];
        }
      }

      try {
        await addUserData(userId, newData);
      } catch (e) {
        console.log('Данные не удалось сохранить', e);
      }
    }
  }

  async function startQuiz(ctx: Context, allowExit = false) {
    if (!ctx.chat || !ctx.from) return;
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id.toString();

    const userData = await getUserData(userId);
    const oldAnswers: Record<string, string> = {};
    if (userData) {
      for (const question of questions) {
        if (userData[question.key]) {
          oldAnswers[question.id] = userData[question.key];
        }
      }
    }
    
    quizStates[chatId] = { step: 0, answers: { ...oldAnswers }, allowExit };
    await sendQuestion(ctx, quizStates[chatId]);
  }

  async function sendQuestion(ctx: Context, state: { step: number; answers: Record<string, string>; allowExit: boolean }) {
    const currentQ = questions[state.step];
    if (!currentQ) return;
    if (currentQ.type === 'buttons') {
      const keyboard = new InlineKeyboard();
      currentQ.options?.forEach((option: string) => keyboard.text(option, `quiz_simple_${option}`).row());
      if (state.allowExit) keyboard.text('Выйти из квиза', 'quiz_exit').row();
      await ctx.reply(currentQ.question, { reply_markup: keyboard, parse_mode: 'HTML' });
    } else {
      if (state.allowExit) {
        const keyboard = new InlineKeyboard().text('Выйти из квиза', 'quiz_exit');
        await ctx.reply(currentQ.question, { reply_markup: keyboard, parse_mode: 'HTML' });
      } else {
        await ctx.reply(currentQ.question, { parse_mode: 'HTML' });
      }
    }
  }

  async function handleQuizText(ctx: Context) {
    if (!ctx.chat || !ctx.message || typeof ctx.message.text !== 'string') return;
    const chatId = ctx.chat.id.toString();
    const state = quizStates[chatId];
    if (!state) return;
    const currentQ = questions[state.step];
    if (currentQ.type === 'text') {
      state.answers[currentQ.id] = ctx.message.text;
      state.step += 1;
      await saveUserFromState(ctx, state);
      if (state.step < questions.length) {
        await sendQuestion(ctx, state);
      } else {
        await showQuizResult(ctx, state.answers);
        delete quizStates[chatId];
      }
    } else if (currentQ.type === 'buttons') {
      await ctx.reply('Пожалуйста, выберите один из предложенных вариантов с помощью кнопок.');
    }
  }

  async function handleQuizButton(ctx: Context) {
    if (!ctx.chat || !ctx.match) return;
    const chatId = ctx.chat.id.toString();
    const state = quizStates[chatId];
    if (!state) return;
    const currentQ = questions[state.step];
    if (currentQ.type === 'buttons') {
      state.answers[currentQ.id] = ctx.match[1];
      state.step += 1;
      await saveUserFromState(ctx, state);
      await ctx.answerCallbackQuery();
      if (state.step < questions.length) {
        await sendQuestion(ctx, state);
      } else {
        await showQuizResult(ctx, state.answers);
        delete quizStates[chatId];
      }
    }
  }

  async function handleQuizExit(ctx: Context) {
    if (!ctx.chat) return;
    const chatId = ctx.chat.id.toString();
    delete quizStates[chatId];
    await ctx.answerCallbackQuery();
    await ctx.reply('Вы вышли из квиза. Ваши ответы частично сохранены.');
  }

  async function showQuizResult(ctx: Context, answers: Record<string, string>) {
    let result = 'Ваши ответы:\n';
    for (const q of questions) {
      result += `${q.key} — ${answers[q.id] || ''}\n`;
    }
    await ctx.reply(result);
  }

  return {
    startQuiz,
    handleQuizText,
    handleQuizButton,
    handleQuizExit
  };
} 