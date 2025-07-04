import { renderSettingsPage } from './settings.fe';
import { handleSettingsPost } from './settings.be';

export async function handler(event: any): Promise<any> {
  // Обработка GET запросов - редактор глобальных настроек
  if (event.httpMethod === 'GET') {
    return await renderSettingsPage(event);
  }
  
  // Обработка POST запросов - бекенд глобальных настроек
  if (event.isBase64Encoded && event.httpMethod === 'POST') {
    return await handleSettingsPost(event);
  }
  
  return { statusCode: 400, body: 'Invalid request' };
}