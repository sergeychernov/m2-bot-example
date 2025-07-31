import { Bot, CommandContext, Context } from 'grammy';
import { setMode } from './ydb';
import { formatMarkdownV2Text, escapeMarkdownV2, isUserProfileComplete } from './telegram-utils';

/**
 * Создает безопасное сообщение для MarkdownV2 с инструкцией активации
 */
export function createActivationMarkdownV2Message(ctx: CommandContext<Context>) {
    const title = formatMarkdownV2Text('Активация бота для работы с клиентами!', { bold: true });
    const final = formatMarkdownV2Text('После выполнения всех шагов бот будет активирован и готов к работе!', { bold: true });
    
    return (
		`🚀 ${title}\n` +
		
        `1️⃣ ${escapeMarkdownV2('Подключить ваш бизнес-аккаунт в Telegram')}\n` +
        `2️⃣ ${escapeMarkdownV2('Добавить этого бота @'+(ctx.me?.username || 'этого_бота')+' к вашему бизнес-аккаунту\n')}` +
        `3️⃣ ${escapeMarkdownV2('В настройках доступа обязательно разрешить читать сообщения и отвечать на них')}\n` +
        `4️⃣ ${escapeMarkdownV2(`Напишите любое сообщение: @${ctx.from?.username === 'realtoririnapetrova' ? 'petrovpaveld' : 'realtoririnapetrova'} чтобы привязать бота к своему аккаунту`)}\n`
			+`✅ ${final}`
    );
}

export function initializeActivateCommand(bot: Bot) {
    bot.command('activate', async (ctx) => {
        const userId = ctx.from?.id;
        if (!userId) {
            await ctx.reply('Не удалось определить ваш ID.');
            return;
        }

        if (!(await isUserProfileComplete(userId))) {
            await ctx.api.sendMessage(userId, 'Сначала полностью заполните профиль, пройдя опросник с помощью команды /quiz');
            return;
        }

        try {
            await setMode(userId, 'activation');
            await ctx.reply(
                createActivationMarkdownV2Message(ctx),
                { parse_mode: 'MarkdownV2' }
            );
            
        } catch (error) {
            console.error('Error in activate command:', JSON.stringify(error));
            await ctx.reply('Произошла ошибка при активации. Попробуйте еще раз.');
        }
    });
}