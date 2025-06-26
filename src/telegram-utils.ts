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

/**
 * Экранирует специальные символы для MarkdownV2
 * @param text - текст для экранирования
 * @returns экранированный текст
 */
export function escapeMarkdownV2(text: string, preserveFormatting: boolean = false): string {
    if (preserveFormatting) {
        // Экранируем все символы кроме форматирования: * _ ~ `
        return text.replace(/[\[\]()>#+=\-|{}.!]/g, '\\$&');
    } else {
        // Экранируем все специальные символы
        return text.replace(/[_*\[\]()~`>#+=\-|{}.!]/g, '\\$&');
    }
}

/**
 * Создает текст с безопасным форматированием для MarkdownV2
 * @param text - исходный текст
 * @param formatting - объект с настройками форматирования
 * @returns отформатированный и экранированный текст
 */
export function formatMarkdownV2Text(text: string, formatting?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    spoiler?: boolean;
    code?: boolean;
}): string {
    // Сначала экранируем текст, сохраняя символы форматирования
    let escapedText = escapeMarkdownV2(text, true);
    
    if (formatting) {
        if (formatting.code) {
            escapedText = `\`${escapedText}\``;
        }
        if (formatting.bold) {
            escapedText = `*${escapedText}*`;
        }
        if (formatting.italic) {
            escapedText = `_${escapedText}_`;
        }
        if (formatting.strikethrough) {
            escapedText = `~${escapedText}~`;
        }
        if (formatting.spoiler) {
            escapedText = `||${escapedText}||`;
        }
    }
    
    return escapedText;
}

/**
 * Создает безопасное сообщение для MarkdownV2
 * @param text - исходный текст
 * @returns объект с экранированным текстом и настройками parse_mode
 */
export function createMarkdownV2Message(text: string) {
    return {
        text: escapeMarkdownV2(text),
        parse_mode: 'MarkdownV2' as const
    };
}

/**
 * Формирует markdown-блок профиля для Telegram MarkdownV2
 * @param userData - объект профиля
 * @returns строка с профилем в формате MarkdownV2
 */
export function formatProfileMarkdownV2(userData: Record<string, any>): string {
  return Object.entries(userData)
    .map(([key, value]) => {
      const displayValue = Array.isArray(value)
        ? value.map(v => formatMarkdownV2Text(v)).join(', ')
        : formatMarkdownV2Text(value);
      return `${formatMarkdownV2Text(key, { bold: true })}: ${displayValue}`;
    })
    .join('\n');
}