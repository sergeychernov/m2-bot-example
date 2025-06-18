import { getLatestPromptByType, Prompt } from './ydb';

export async function renderSettingsPage(): Promise<any> {
  const currentPrompt = await getLatestPromptByType('base') as Prompt;

  // Default values if no prompt is found (e.g., first run before setup-db adds one)
  const promptText = currentPrompt?.promptText || '';
  const model = currentPrompt?.model || '/yandexgpt-lite/latest';
  const stream = currentPrompt?.stream || false;
  const temperature = currentPrompt?.temperature || 0.6;
  const maxTokens = currentPrompt?.maxTokens || 20000;
  
  const body = `
      <!DOCTYPE html>
      <html lang="ru" style="height: 100%; margin: 0; padding: 0;">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Настройки GPT</title>
        <style>
          html, body {
            height: 100%;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column; /* Ensure body itself can grow */
          }
          form {
            flex-grow: 1; /* Allow form to take up available space */
            display: flex;
            flex-direction: column; /* Form content flows vertically */
            padding: 20px; /* Add some padding around the form */
            box-sizing: border-box; /* Include padding in height calculation */
          }
          .form-columns-container {
            display: flex;
            gap: 20px;
            flex-grow: 1; /* Allow this container to fill the form's height */
            /* Default to row layout for larger screens */
            flex-direction: row;
          }
          .form-column-left {
            flex-grow: 1;
            flex-basis: 0;
            max-width: 1280px;
            display: flex; /* Enable flex for vertical alignment of label and textarea */
            flex-direction: column; /* Stack label and textarea vertically */
          }
          .form-column-right {
            flex-shrink: 0;
            flex-basis: 260px;
            min-width: 260px;
          }
          textarea {
            flex-grow: 1; /* Allow textarea to fill available vertical space */
            width: 100%;
            box-sizing: border-box;
            resize: vertical; /* Allow vertical resizing only if needed */
          }

          /* Media query for mobile devices */
          @media (max-width: 768px) {
            .form-columns-container {
              flex-direction: column; /* Stack columns vertically */
            }
            .form-column-left,
            .form-column-right {
              flex-basis: auto; /* Allow columns to take full width */
              min-width: 0; /* Reset min-width for stacking */
              max-width: 100%; /* Allow columns to take full width */
            }
          }
        </style>
      </head>
      <body style="height: 100%; margin: 0; padding: 0; display: flex; flex-direction: column;">
        <form method="POST" style="flex-grow: 1; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;">
          <h1>Настройки GPT Промпта (тип: base)</h1>
          <div class="form-columns-container" style="display: flex; gap: 20px; flex-grow: 1;"> 
            <div class="form-column-left" style="flex-grow: 1; flex-basis: 0; max-width: 1280px; display: flex; flex-direction: column;"> 
              <label for="promptText">Текст промпта:</label>
              <textarea id="promptText" name="promptText" rows="15" style="flex-grow: 1; width: 100%; box-sizing: border-box;" placeholder="Вставьте сюда текст промпта...">${promptText}</textarea>
            </div>
            <div class="form-column-right" style="flex-shrink: 0; flex-basis: 260px; min-width: 260px;"> 
              <div>
                <label for="model" style="display: inline-block; margin-right: 10px;">Модель:</label><input type="text" id="model" name="model" value="${model}" style="display: inline-block; width: auto;">
              </div>
              <div>
                <label for="temperature" style="display: inline-block; margin-right: 10px;">Temperature:</label><input type="number" id="temperature" name="temperature" value="${temperature}" step="0.1" style="display: inline-block; width: auto;">
              </div>
              <div>
                <label for="maxTokens" style="display: inline-block; margin-right: 10px;">Max Tokens:</label><input type="number" id="maxTokens" name="maxTokens" value="${maxTokens}" style="display: inline-block; width: auto;">
              </div>
              <div>
                <label for="stream" style="display: inline-block; margin-right: 10px;">Stream:</label><input type="checkbox" id="stream" name="stream" ${stream ? 'checked' : ''} style="display: inline-block; width: auto; vertical-align: middle;">
              </div>
            </div>
          </div>
          <button type="submit">Сохранить настройки</button>
        </form>
      </body>
      </html>
    `;
  return {
	statusCode: 200,
	headers: { 'Content-Type': 'text/html; charset=utf-8' },
	body, 
  };
}