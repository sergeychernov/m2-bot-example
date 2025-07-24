import { Context } from 'grammy';
import { bot } from './bot-instance';
import { iam } from './iam';

interface SpeechKitResponse {
    result?: {
        alternatives?: Array<{
            words?: Array<{
                word: string;
                startTime: string;
                endTime: string;
                confidence: number;
            }>;
            text: string;
            confidence: number;
        }>;
    };
    error?: {
        code: number;
        message: string;
    };
}

function getFormatFromMimeType(mimeType: string): { format: string; sampleRate?: string } {
    switch (mimeType) {
        case 'audio/ogg':
        case 'audio/ogg; codecs=opus':
            // Для oggopus не указываем sampleRateHertz - используется значение по умолчанию 48000
            return { format: 'oggopus' };
        case 'audio/mpeg':
        case 'audio/mp3':
            // MP3 не поддерживается напрямую, конвертируем в lpcm
            return { format: 'lpcm', sampleRate: '16000' };
        case 'audio/wav':
        case 'audio/wave':
        case 'audio/x-wav':
            return { format: 'lpcm', sampleRate: '16000' };
        case 'audio/webm':
        case 'audio/webm; codecs=opus':
            return { format: 'oggopus' };
        default:
            console.warn(`Unknown MIME type: ${mimeType}, defaulting to oggopus`);
            return { format: 'oggopus' };
    }
}

export async function recognizeSpeech(audioBuffer: ArrayBuffer, mime_type: string, iamToken: string): Promise<string | null> {
    try {
        console.log('Starting speech recognition...');
        console.log('IAM token length:', iamToken ? iamToken.length : 'null');
        console.log('Audio buffer size:', audioBuffer.byteLength);
        console.log('MIME type:', mime_type);

        const { format, sampleRate } = getFormatFromMimeType(mime_type);
        console.log(`Using format: ${format}${sampleRate ? `, sample rate: ${sampleRate}` : ' (default sample rate)'}`);

        const url = new URL('https://stt.api.cloud.yandex.net/speech/v1/stt:recognize');
        url.searchParams.set('topic', 'general');
        url.searchParams.set('lang', 'ru-RU');
        url.searchParams.set('format', format);

        if (format === 'lpcm' && sampleRate) {
            url.searchParams.set('sampleRateHertz', sampleRate);
        }
        
        console.log('Sending request to SpeechKit...');
        console.log('URL:', url.toString());

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${iamToken}`,
                'Content-Type': 'application/octet-stream'
            },
            body: audioBuffer
        });
        
        console.log('Response status:', response.status);
        console.log('Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('SpeechKit API error details:');
            console.error('Status:', response.status);
            console.error('Status text:', response.statusText);
            console.error('Error body:', errorText);

            if (response.status === 401) {
                console.error('Authorization failed. Check:');
                console.error('1. IAM token validity');
                console.error('2. Service account roles: ai.speechkit-stt.user, ai.languageModels.user');
                console.error('3. Folder permissions');
            }
            
            throw new Error(`SpeechKit API error: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Response body:', JSON.stringify(result));
        
        if (result.error_code) {
            console.error('SpeechKit recognition error:', result.error_message);
            return null;
        }
        
        if (result.result) {
            console.log('Recognized text:', result.result);
            return result.result;
        }
        
        console.log('No recognition result found');
        return null;
    } catch (error) {
        console.error('Error in speech recognition:', error);
        throw error;
    }
}

export async function handleVoiceMessage(fileId: string, chatId: number, mime_type:string, userId: number, context?: Context) {
    try {
        const iamToken = iam(context);
        if (!iamToken) {
            throw new Error('IAM token not available');
        }

        const file = await bot.api.getFile(fileId);

        const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
        
        console.log('Voice file URL:', fileUrl);
        console.log('File size:', file.file_size);
		console.log('File path:', file.file_path);
		
		console.log('File:', JSON.stringify(file));

        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }
        
        const audioBuffer = await response.arrayBuffer();

        const recognizedText = await recognizeSpeech(audioBuffer, mime_type, iamToken);
        
        if (recognizedText) {
            
            return {
                fileUrl,
                audioBuffer,
                fileInfo: file,
                recognizedText
            };
        } else {
            const errorText = '❌ Не удалось распознать речь в голосовом сообщении';
            
            if (userId) {
                await bot.api.sendMessage(userId, errorText);
            } else {
                console.error('bot.api.sendMessage(userId, errorText):', JSON.stringify(errorText));
            }
            
            return {
                fileUrl,
                audioBuffer,
                fileInfo: file,
                recognizedText: null
            };
        }
        
    } catch (error) {
        console.error('Error handling voice message:', error);
        const errorText = '❌ Произошла ошибка при обработке голосового сообщения';
        try {
            if (context?.businessConnectionId) {
                await bot.api.sendMessage(chatId, errorText, { 
                    business_connection_id: context.businessConnectionId 
                });
            } else {
                await bot.api.sendMessage(chatId, errorText);
            }
        } catch (sendError) {
            console.error('Error sending error message:', sendError);
        }
        
        throw error;
    }
}