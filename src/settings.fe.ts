import { getLatestPromptByType, Prompt, getQuizConfig } from './ydb';
import quizSchema from './quiz-schema.json';

export async function renderSettingsPage(): Promise<any> {
  const currentPrompt = await getLatestPromptByType('base') as Prompt;
  const quizConfig = await getQuizConfig() || {};

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
        <title>Настройки GPT и Квиза</title>
        <style>
          html, body {
            height: 100vh;
            max-height: 100vh;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          form {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            padding: 20px;
            box-sizing: border-box;
            overflow: hidden;
          }
          .form-columns-container {
            display: flex;
            gap: 20px;
            flex-grow: 1;
            flex-direction: row;
          }
          .form-column-left {
            flex-grow: 0;
            flex-basis: 70%;
            max-width: 70%;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .form-column-right {
            flex-grow: 0;
            flex-basis: 30%;
            max-width: 30%;
            display: flex;
            flex-direction: column;
          }
          .form-column-right .settings-section {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
          }
          .form-column-right .form-group {
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            margin-bottom: 0;
          }
          .form-column-right textarea {
            flex-grow: 1;
            min-height: 0;
          }
          .settings-section {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            background: #f9f9f9;
          }
          .settings-section h3 {
            margin-top: 0;
            margin-bottom: 15px;
            color: #333;
            border-bottom: 2px solid #007bff;
            padding-bottom: 5px;
          }
          .form-group {
            margin-bottom: 15px;
          }
          .form-group-row {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
          }
          .form-group-row .form-group {
            flex: 1;
            margin-bottom: 0;
          }
          .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
            color: #555;
          }
          .form-group input[type="text"],
          .form-group input[type="number"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-sizing: border-box;
          }
          .form-group input[type="checkbox"] {
            margin-left: 0;
          }
          textarea {
            flex-grow: 1;
            width: 100%;
            box-sizing: border-box;
            resize: vertical;
            min-height: 200px;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.4;
          }
          #jsoneditor {
            height: 400px;
            border: 1px solid #ddd;
            border-radius: 4px;
          }
          .json-error {
            color: #dc3545;
            font-size: 12px;
            margin-top: 5px;
          }
          .json-valid {
            color: #28a745;
            font-size: 12px;
            margin-top: 5px;
          }
          .validation-status {
            margin-top: 10px;
            padding: 10px;
            border-radius: 4px;
            font-size: 14px;
          }
          .validation-error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
          }
          .validation-success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
          }
          button[type="submit"] {
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
          }
          button[type="submit"]:hover {
            background: #0056b3;
          }
          .prompt-info {
            background: #e7f3ff;
            border: 1px solid #b3d9ff;
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 15px;
            font-size: 14px;
          }
          .prompt-info strong {
            color: #0056b3;
          }

          /* Media query for mobile devices */
          @media (max-width: 768px) {
            .form-columns-container {
              flex-direction: column;
            }
            .form-column-left,
            .form-column-right {
              flex-basis: auto;
              min-width: 0;
              max-width: 100%;
            }
            .form-group-row {
              flex-direction: column;
              gap: 10px;
            }
            textarea {
              min-height: 150px;
            }
            .settings-section {
              margin-bottom: 15px;
            }
          }
          
          /* Улучшения для больших экранов */
          @media (min-width: 1200px) {
            .form-columns-container {
              gap: 30px;
            }
            .settings-section {
              padding: 20px;
            }
            textarea {
              min-height: 250px;
            }
          }
        </style>
      </head>
      <body style="height: 100%; margin: 0; padding: 0; display: flex; flex-direction: column;">
        <form method="POST" style="flex-grow: 1; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;" onsubmit="validateBeforeSubmit(event)">
          <h1>Настройки GPT Промпта и Квиза</h1>
          
          <div class="form-columns-container"> 
            <div class="form-column-left"> 
              <div class="settings-section">
                <h3>⚙️ Настройки модели</h3>
                <div class="form-group-row">
                  <div class="form-group">
                    <label for="model">Модель:</label>
                    <input type="text" id="model" name="model" value="${model}">
                  </div>
                  <div class="form-group">
                    <label for="temperature">Temperature:</label>
                    <input type="number" id="temperature" name="temperature" value="${temperature}" step="0.1" min="0" max="2">
                  </div>
                </div>
                <div class="form-group-row">
                  <div class="form-group">
                    <label for="maxTokens">Max Tokens:</label>
                    <input type="number" id="maxTokens" name="maxTokens" value="${maxTokens}" min="1" max="20000">
                  </div>
                  <div class="form-group">
                    <label for="stream">
                      <input type="checkbox" id="stream" name="stream" ${stream ? 'checked' : ''}>
                      Stream (потоковая передача)
                    </label>
                  </div>
                </div>
              </div>

              <div class="settings-section">
                <h3>🤖 Промпт для GPT</h3>
                <div class="prompt-info">
                  <strong>Подсказка:</strong> Используйте {{profile}} для вставки профиля пользователя, {{имя_поля}} для вставки данных из профиля.
                </div>
                <div class="form-group">
                  <label for="promptText">Текст системного промпта:</label>
                  <textarea id="promptText" name="promptText" placeholder="Вставьте сюда текст системного промпта для GPT...">${promptText}</textarea>
                </div>
              </div>
            </div>
            
            <div class="form-column-right"> 
              <div class="settings-section">
                <h3>🎯 Конфигурация квиза</h3>
                <div class="form-group">
                  <label for="quizConfig">JSON конфигурация:</label>
                  <textarea id="quizConfig" name="quizConfig" onchange="validateQuizConfig()" onkeyup="validateQuizConfig()">${JSON.stringify(quizConfig, null, 2)}</textarea>
                  <div id="validationStatus"></div>
                </div>
              </div>
            </div>
          </div>
          
          <button type="submit" id="submitBtn">💾 Сохранить все настройки</button>
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