import {Context} from "grammy";
import {Message} from "grammy/out/types";

export async function handleMediaMessage (ctx: Context, message: Message, userId: number) {
    const clientUsername = message.chat?.username;
    const clientId = message.chat?.id;
    let clientLink = clientUsername
        ? `https://t.me/${clientUsername}`
        : `tg://user?id=${clientId}`;

    const notifyText = `Клиент прислал файл, который бот пока не умеет обрабатывать, поэтому нужно ответить вручную. [Открыть чат с клиентом](${clientLink})`;

    await ctx.api.sendMessage(userId, notifyText, { parse_mode: 'Markdown' });
}