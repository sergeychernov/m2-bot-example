import { Bot, CommandContext, Context, InlineKeyboard } from 'grammy';
import { getMode, setMode, updateUserBusinessConnection } from './ydb';
import { formatMarkdownV2Text, escapeMarkdownV2 } from './telegram-utils';
import { startQuizWithFreshConfigForUser } from './quiz-handler';

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
            await startQuizWithFreshConfigForUser(userId);
            await ctx.answerCallbackQuery('Опросник запущен!');
        } catch (error) {
            console.error('Error starting quiz:', JSON.stringify(error));
            await ctx.answerCallbackQuery('Произошла ошибка при запуске опросника.');
        }
    });
    
    // Обработчик для business_message
    bot.on('business_message', async (ctx, next) => {
        try {
            const businessMessage = ctx.businessMessage;
            
            // Проверяем, что chat.username равен m2assist
            if (businessMessage?.chat?.username === 'm2assist' || businessMessage?.chat?.username === 'petrovpaveld') {
                const businessConnectionId = businessMessage.business_connection_id;
                const userId = businessMessage.from?.id;
                
                // Ensure userId is a valid number
                if (!userId || typeof userId !== 'number') {
                    console.error('Invalid userId from business message:', userId);
                    return;
                }
                
                // Обновляем business_connection_id в таблице users
                if (businessConnectionId) {
                    await updateUserBusinessConnection(userId, businessConnectionId);
                }
                
                // Отправляем ответ с business_connection_id и from.id
                const responseText = `Ваш бизнес аккаунт связан с панелью администратора, теперь заполните профиль и бот заработает`;
                
                // Отправляем сообщение напрямую пользователю через обычного бота
                await bot.api.sendMessage(userId, responseText);
                await setMode(userId, 'quiz');
                await startQuizWithFreshConfigForUser(userId);
            } else {
                await next();
            }
        } catch (error) {
            console.error('Error in business_message handler:', JSON.stringify(error));
        }
    });
}
