import { Context, InlineKeyboard } from 'grammy';
import fs from 'fs';
import path from 'path';

const questions = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'quiz.json'), 'utf-8')
);

const quizStates: Record<string, { step: number; answers: Record<string, string> }> = {};

export async function startQuiz(ctx: Context) {
  if (!ctx.chat) return;
  const chatId = ctx.chat.id.toString();
  quizStates[chatId] = { step: 0, answers: {} };
  await ctx.reply(questions[0].question);
}

export async function handleQuizText(ctx: Context) {
  if (!ctx.chat || !ctx.message || typeof ctx.message.text !== 'string') return;
  const chatId = ctx.chat.id.toString();
  const state = quizStates[chatId];
  if (!state) return;
  const currentQ = questions[state.step];
  if (currentQ.type === 'text') {
    state.answers[currentQ.id] = ctx.message.text;
    state.step += 1;
    if (state.step < questions.length) {
      const nextQ = questions[state.step];
      if (nextQ.type === 'buttons') {
        const keyboard = new InlineKeyboard();
        nextQ.options?.forEach((option: string) => keyboard.text(option, `quiz_simple_${option}`).row());
        await ctx.reply(nextQ.question, { reply_markup: keyboard });
      } else {
        await ctx.reply(nextQ.question);
      }
    } else {
      await showQuizResult(ctx, state.answers);
      delete quizStates[chatId];
    }
  }
}

export async function handleQuizButton(ctx: Context) {
  if (!ctx.chat || !ctx.match) return;
  const chatId = ctx.chat.id.toString();
  const state = quizStates[chatId];
  if (!state) return;
  const currentQ = questions[state.step];
  if (currentQ.type === 'buttons') {
    state.answers[currentQ.id] = ctx.match[1];
    state.step += 1;
    await ctx.answerCallbackQuery();
    if (state.step < questions.length) {
      const nextQ = questions[state.step];
      if (nextQ.type === 'buttons') {
        const keyboard = new InlineKeyboard();
        nextQ.options?.forEach((option: string) => keyboard.text(option, `quiz_simple_${option}`).row());
        await ctx.reply(nextQ.question, { reply_markup: keyboard });
      } else {
        await ctx.reply(nextQ.question);
      }
    } else {
      await showQuizResult(ctx, state.answers);
      delete quizStates[chatId];
    }
  }
}

async function showQuizResult(ctx: Context, answers: Record<string, string>) {
  let result = 'Ваши ответы:\n';
  for (const q of questions) {
    result += `${q.question} — ${answers[q.id] || ''}\n`;
  }
  await ctx.reply(result);
} 