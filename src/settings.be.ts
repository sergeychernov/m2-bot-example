import { addPrompt } from './ydb';

export async function handleSettingsPost(event: any): Promise<any> {
  let bodyString = Buffer.from(event.body, 'base64').toString('utf-8');
  let textData = ''; // Эта переменная не используется, но оставлена для соответствия оригиналу

  if (bodyString) {
    const params = new URLSearchParams(bodyString);
    const promptText = params.get('promptText')?.replace(/\r\n/g, '\n') || '';
    const model = params.get('model') || '/yandexgpt-lite/latest';
    const temperatureStr = params.get('temperature');
    const temperature = temperatureStr ? parseFloat(temperatureStr) : 0.6;
    const maxTokensStr = params.get('maxTokens');
    const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : 20000;
    const stream = params.get('stream') === 'on';
    await addPrompt(promptText, 'base', model, stream, temperature, maxTokens);
    textData = promptText; // Присваиваем значение, чтобы соответствовать логике оригинального кода
  }

  const formUrl = event.url;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `
      <html>
        <head>
          <meta http-equiv="refresh" content="3;url=${formUrl}">
          <title>Сохранение данных</title>
        </head>
        <body>
          <p>Форма сохранена. Размер: ${textData.length}.</p>
          <p>Вы будете перенаправлены обратно через 3 секунды. Если нет, нажмите <a href="${formUrl}">сюда</a>.</p>
        </body>
      </html>
    `,
  };
}