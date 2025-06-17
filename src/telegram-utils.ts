import { Context } from "grammy";
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
  
export async function imitateTyping(ctx: Context, startDelay: number = 0, delay: number = 5000): Promise<void> {
	try {
		const businessConnectionId = ctx.businessConnectionId || ctx.message?.business_connection_id;
		const chatId = ctx.chat?.id;
		const step = 3000;
		if(startDelay> 5000) {
			startDelay = 5000;
		}
		if(delay > 30000) {
			delay = 30000;
		}
		const counter = delay > step ? delay / step : 1;
		console.log('imitateTyping', delay, startDelay, counter);
		if (startDelay) {
			await sleep(startDelay);
		}
		if (chatId) {
			for (let i = 0; i < counter; i++) {
				if (Math.random() < 0.5) {
					await ctx.api.sendChatAction(chatId, 'typing', { business_connection_id: businessConnectionId });
				}
				if (i < counter - 1) {
					await sleep(step);
				}
			}
		}
	} catch (e) {
		console.error('Error sending typing action:', JSON.stringify(e));
	  }
}