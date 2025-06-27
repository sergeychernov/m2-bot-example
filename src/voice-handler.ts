import { bot } from './bot-instance';

export async function handleVoiceMessage(fileId: string, chatId: number, businessConnectionId?: string) {
    try {
        // Получаем информацию о файле
        const file = await bot.api.getFile(fileId);
        
        // Формируем URL для скачивания
        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        
        console.log('Voice file URL:', fileUrl);
        console.log('File size:', file.file_size);
        console.log('File path:', file.file_path);
        
        // Скачиваем файл
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }
        
        const audioBuffer = await response.arrayBuffer();
        
        // Здесь вы можете:
        // 1. Сохранить файл локально
        // 2. Загрузить в облачное хранилище
        // 3. Отправить на обработку (например, speech-to-text)
        // 4. Конвертировать в другой формат
        
        return {
            fileUrl,
            audioBuffer,
            fileInfo: file
        };
        
    } catch (error) {
        console.error('Error handling voice message:', error);
        throw error;
    }
}