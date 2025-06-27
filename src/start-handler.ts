import { Bot, CommandContext, Context } from 'grammy';
import { getMode, setMode, updateUserBusinessConnection } from './ydb';
import { formatMarkdownV2Text, escapeMarkdownV2 } from './telegram-utils';
import { startQuizWithFreshConfig, startQuizWithFreshConfigForUser } from './quiz-handler';

/**
 * Создает безопасное сообщение для MarkdownV2 с готовым форматированием
 */
export function createSafeMarkdownV2Message(ctx: CommandContext<Context>) {
    const title = formatMarkdownV2Text('Добро пожаловать в бот для удержания клиентов!', { bold: true });
    const subtitle = formatMarkdownV2Text('Этот бот поможет вам:', { bold: true });
    const instruction = formatMarkdownV2Text('Для начала работы необходимо:', { bold: true });
    const guide = formatMarkdownV2Text('Инструкция по подключению:', { bold: true });
    const guideSubtitle = formatMarkdownV2Text(`Чтобы связать админку бота с бизнес аккаунтом напишите любое сообщение: @${ctx.from?.username === 'm2assist' ? 'petrovpaveld' : 'm2assist'}`, { italic:true });
    const final = formatMarkdownV2Text('После подключения бот автоматически начнет работать с вашими клиентами!', { bold: true });
    
    return (
        `🏢 ${title}\n\n` +
        `📈 ${subtitle}\n` +
        `• ${escapeMarkdownV2('Удерживать клиентов через автоматизированное общение')}\n` +
        `• ${escapeMarkdownV2('Отвечать на вопросы клиентов 24/7')}\n` +
        `• ${escapeMarkdownV2('Собирать информацию о потребностях клиентов')}\n` +
        `• ${escapeMarkdownV2('Повышать конверсию и лояльность')}\n\n` +
        `🔗 ${instruction}\n` +
        `1️⃣ ${escapeMarkdownV2('Подключить ваш бизнес-аккаунт в Telegram')}\n` +
        `2️⃣ ${escapeMarkdownV2('Добавить этого бота к вашему бизнес-аккаунту')}\n\n` +
        `📋 ${guide}\n` +
        `• ${escapeMarkdownV2('Перейдите в настройки Telegram')}\n` +
        `• ${escapeMarkdownV2('Выберите "Бизнес"')}\n` +
        `• ${escapeMarkdownV2('Найдите раздел "Чат-боты"')}\n` +
		`• ${escapeMarkdownV2('Добавьте @' + (ctx.me?.username || 'этого_бота'))}\n\n` +
		`📋 ${guideSubtitle}\n` +
        `✅ ${final}`
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
            if (await getMode(userId) === 'first-start') {
                await setMode(userId, 'first-start');
                await ctx.reply(
                    createSafeMarkdownV2Message(ctx),
                    { parse_mode: 'MarkdownV2' }
                );
            }
            
        } catch (error) {
            console.error('Error in start command:', JSON.stringify(error));
            await ctx.reply('Произошла ошибка. Попробуйте еще раз.');
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
