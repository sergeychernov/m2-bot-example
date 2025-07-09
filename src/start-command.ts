import { Bot, CommandContext, Context, InlineKeyboard } from 'grammy';
import { getMode, setMode, updateUserBusinessConnection } from './ydb';
import { formatMarkdownV2Text, escapeMarkdownV2 } from './telegram-utils';
import { startQuizWithFreshConfig } from './quiz-handler';

/**
 * Создает безопасное сообщение для MarkdownV2 с готовым форматированием
 */
export function createSafeMarkdownV2Message(ctx: CommandContext<Context>) {
    const title = formatMarkdownV2Text('Добро пожаловать в бот для удержания клиентов!', { bold: true });
    const subtitle = formatMarkdownV2Text('Этот бот поможет вам:', { bold: true });
    const instruction = formatMarkdownV2Text('Для начала работы необходимо:', { bold: true });
    return (
        `🏢 ${title}\n\n` +
        `📈 ${subtitle}\n` +
        `• ${escapeMarkdownV2('Удерживать клиентов через автоматизированное общение')}\n` +
        `• ${escapeMarkdownV2('Отвечать на вопросы клиентов 24/7')}\n` +
        `• ${escapeMarkdownV2('Собирать информацию о потребностях клиентов')}\n` +
        `• ${escapeMarkdownV2('Повышать конверсию и лояльность')}\n\n` +
        `🔗 ${escapeMarkdownV2('Пройдите короткий опросник, чтобы бот подстроился под ваши методы работы')}\n\n`
    );
}

export function initializeStartCommand(bot: Bot) {
    bot.command('start', async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('Не удалось определить ваш ID.');
            return;
        }

        try {
            if (await getMode(userId) === 'none') {
                await setMode(userId, 'start');
                
                // Создаем inline клавиатуру с кнопкой
                const keyboard = new InlineKeyboard()
                    .text('📝 Пройти опросник', 'start_quiz');
                
                await ctx.reply(
                    createSafeMarkdownV2Message(ctx),
                    { 
                        parse_mode: 'MarkdownV2',
                        reply_markup: keyboard
                    }
                );
            }
            
        } catch (error) {
            console.error('Error in start command:', JSON.stringify(error));
            await ctx.reply('Произошла ошибка. Попробуйте еще раз.');
        }
    });
    
    // Обработчик для нажатия на кнопку "Пройти опросник"
    bot.callbackQuery('start_quiz', async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.answerCallbackQuery('Не удалось определить ваш ID.');
            return;
        }

        try {
            await setMode(userId, 'quiz');
            await startQuizWithFreshConfig(userId);
            await ctx.answerCallbackQuery('Опросник запущен!');
        } catch (error) {
            console.error('Error starting quiz:', JSON.stringify(error));
            await ctx.answerCallbackQuery('Произошла ошибка при запуске опросника.');
        }
    });
    

}
