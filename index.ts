import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN as string);

// Простейшая реакция на текст «ping»
bot.hears('ping', async (ctx) => {
  await ctx.reply('pong');
});

// Обработчик Cloud Function
export async function handler(event: any) {
  try {
    // Yandex Cloud передаёт вебхук в body
    const update = JSON.parse(event.body);
    await bot.handleUpdate(update);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Error:', err);
    return { statusCode: 500, body: 'Error' };
  }
}
