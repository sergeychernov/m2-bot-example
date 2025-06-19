import { Context, InlineKeyboard } from 'grammy';
import { addUser, User, getUser } from './ydb';
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
      const oldUser = await getUser(ctx.from.id.toString());
      const user: User = {
        userId: ctx.from.id.toString(),
        firstName: state.answers['1'] || oldUser?.firstName || '',
        lastName: state.answers['2'] || oldUser?.lastName || '',
        occupation: state.answers['3'] || oldUser?.occupation || '',
        experience: state.answers['4'] || oldUser?.experience || '',
        dealTypes: state.answers['5'] || oldUser?.dealTypes || '',
        workStyle: state.answers['6'] || oldUser?.workStyle || '',
        usageGoal: state.answers['7'] || oldUser?.usageGoal || '',
        phone: state.answers['8'] || oldUser?.phone || '',
        email: state.answers['9'] || oldUser?.email || '',
      };
      try {
        await addUser(user);
      } catch (e) {
        console.log('Данные не удалось сохранить', e);
      }
    }
  }

  async function startQuiz(ctx: Context, allowExit = false) {
    if (!ctx.chat) return;
    const chatId = ctx.chat.id.toString();
    let oldAnswers: Record<string, string> = {};
    if (ctx.from) {
      const user = await getUser(ctx.from.id.toString());
      if (user) {
        oldAnswers = {
          '1': user.firstName,
          '2': user.lastName,
          '3': user.occupation,
          '4': user.experience,
          '5': user.dealTypes,
          '6': user.workStyle,
          '7': user.usageGoal,
          '8': user.phone,
          '9': user.email,
        };
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
      result += `${q.question} — ${answers[q.id] || ''}\n`;
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