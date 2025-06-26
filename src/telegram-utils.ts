export async function imitateTypingBatch(
	bot: any,
	chatId: number,
	startDelay: number = 0,
	delay: number = 5000
): Promise<void> {
	try {
		const step = 3000;
		if (startDelay > 5000) startDelay = 5000;
		if (delay > 30000) delay = 30000;
		const counter = delay > step ? Math.floor(delay / step) : 1;
		if (startDelay) await new Promise(res => setTimeout(res, startDelay));
		for (let i = 0; i < counter; i++) {
			if (Math.random() < 0.5) {
				await bot.api.sendChatAction(chatId, 'typing');
			}
			if (i < counter - 1) await new Promise(res => setTimeout(res, step));
		}
	} catch (e) {
		console.error('Error sending typing action (batch):', JSON.stringify(e));
	}
}