import { Bot } from 'grammy';

const botToken = process.env.BOT_TOKEN;
if (!botToken) throw new Error('BOT_TOKEN must be provided!');
export const bot = new Bot(botToken); 