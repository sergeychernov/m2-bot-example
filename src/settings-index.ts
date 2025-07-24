import { renderSettingsPage } from './settings.fe';
import { handleSettingsPost } from './settings.be';

export async function handler(event: any): Promise<any> {
  if (event.httpMethod === 'GET') {
    return await renderSettingsPage(event);
  }

  if (event.isBase64Encoded && event.httpMethod === 'POST') {
    return await handleSettingsPost(event);
  }
  
  return { statusCode: 400, body: 'Invalid request' };
}