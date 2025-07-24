import { getLatestPromptByType, Prompt, getQuizConfig } from './ydb';

const AVAILABLE_MODELS = {
  '/yandexgpt-lite/latest': '/yandexgpt-lite/latest',
  '/yandexgpt/latest': '/yandexgpt/latest',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-flash-lite-preview-06-17': 'gemini-2.5-flash-lite-preview-06-17',
};

const DEFAULT_MODEL = '/yandexgpt-lite/latest';

const AVAILABLE_TABS = [
  { key: 'quiz', label: '🎯 Квиз' },
  { key: 'base', label: '📝 Основной промпт' },
  { key: 'promptDetails', label: '🛠️ Уточнения к промпту' },
  { key: 'summary', label: '📝 Промпт для саммари' },
];

export async function renderSettingsPage(event: any): Promise<any> {
  const queryParams = event.queryStringParameters || {};
  const view = queryParams.view || 'base'; // 'base', 'summary', or 'quiz'
  const baseUrl = event.url.split('?')[0];

  let formContent = '';
  let pageTitle = 'Настройки';

  if (view === 'base' || view === 'summary') {
    const promptType = view;
    pageTitle = `Настройки промпта: ${promptType}`;
    const currentPrompt = await getLatestPromptByType(promptType) as Prompt;

    const promptText = currentPrompt?.promptText || '';
    const rawModel = currentPrompt?.model || DEFAULT_MODEL;
    const model = Object.keys(AVAILABLE_MODELS).includes(rawModel) ? rawModel : DEFAULT_MODEL;
    const temperature = currentPrompt?.temperature || 0.6;
    const maxTokens = currentPrompt?.maxTokens || 20000;
    const pauseBotTime = currentPrompt?.pauseBotTime ?? 10;

    const modelOptions = Object.entries(AVAILABLE_MODELS)
      .map(([value, label]) => 
        `<option value="${value}" ${model === value ? 'selected' : ''}>${label}</option>`
      ).join('\n                    ');

    formContent = `
      <form method="POST" style="flex-grow: 1; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;">
        <input type="hidden" name="formType" value="${promptType}">
        <div class="form-columns-container">
          <div class="form-column-left">
            <div class="settings-section" style="flex-grow: 1; display: flex; flex-direction: column;">
              <h3>🤖 Промпт для GPT (${promptType})</h3>
              <div class="prompt-info">
                <strong>Подсказка:</strong> Используйте {{profile}} для вставки профиля пользователя, {{имя_поля}} для вставки данных из профиля.
              </div>
              <div class="form-group" style="flex-grow: 1; display: flex; flex-direction: column;">
                <label for="promptText" style="flex-shrink: 0;">Текст системного промпта:</label>
                <textarea id="promptText" name="promptText" placeholder="Вставьте сюда текст системного промпта для GPT..." style="flex-grow: 1;">${promptText}</textarea>
              </div>
            </div>
          </div>
          <div class="form-column-right">
            <div class="settings-section">
              <h3>⚙️ Настройки модели</h3>
              <div class="form-group-row">
                <div class="form-group">
                  <label for="model">Модель:</label>
                  <select id="model" name="model">
                    ${modelOptions}
                  </select>
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
                  <label for="pauseBotTime">Время приостановки бота (мин):</label>
                  <input type="number" id="pauseBotTime" name="pauseBotTime" value="${pauseBotTime}" min="1" max="1440">
                </div>
              </div>
            </div>
          </div>
        </div>
        <button type="submit">💾 Сохранить настройки промпта</button>
      </form>
    `;
  } else if (view === 'quiz') {
    pageTitle = 'Настройки квиза';
    const quizConfig = await getQuizConfig() || {};
    formContent = `
      <form method="POST" style="flex-grow: 1; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;">
        <input type="hidden" name="formType" value="quiz">
        <div class="settings-section" style="height: 100%; display: flex; flex-direction: column;">
          <h3>🎯 Конфигурация квиза</h3>
          <div class="form-group" style="flex-grow: 1; display: flex; flex-direction: column;">
            <label for="quizConfig">JSON конфигурация:</label>
            <textarea id="quizConfig" name="quizConfig" oninput="validateQuizConfig()" style="flex-grow: 1;">${JSON.stringify(quizConfig, null, 2)}</textarea>
            <div id="validationStatus"></div>
          </div>
        </div>
        <button type="submit">💾 Сохранить конфигурацию квиза</button>
      </form>
    `;
  } else if (view === 'promptDetails') {
    pageTitle = 'Уточнения к промпту';
    const currentPrompt = await getLatestPromptByType('base') as Prompt;
    const greetingText = currentPrompt?.greetingPrompt || '';
    const dialogText = currentPrompt?.dialogPrompt || '';
    formContent = `
      <form method="POST" style="flex-grow: 1; display: flex; flex-direction: column; padding: 20px; box-sizing: border-box;">
        <input type="hidden" name="formType" value="promptDetails">
        <div class="settings-section" style="flex-grow: 1; display: flex; flex-direction: column;">
          <h3>🛠️ Уточнения к промпту</h3>
          <div class="prompt-info" style="margin-bottom: 15px;">
            <strong>Эти уточнения будут автоматически добавлены к основному промпту в зависимости от ситуации:</strong><br>
            <ul style="margin: 8px 0 0 20px;">
              <li><b>Приветствие</b> — используется только в самом первом сообщении диалога.</li>
              <li><b>Диалог</b> — используется для всех последующих сообщений (без приветствия).</li>
            </ul>
          </div>
          <div class="form-columns-container" style="display: flex; gap: 20px;">
            <div class="form-group" style="flex: 1; display: flex; flex-direction: column;">
              <label for="greetingText">Приветствие:</label>
              <textarea id="greetingText" name="greetingText" placeholder="Введите уточнение для приветствия..." style="flex-grow: 1; min-height: 200px;">${greetingText}</textarea>
            </div>
            <div class="form-group" style="flex: 1; display: flex; flex-direction: column;">
              <label for="dialogText">Диалог:</label>
              <textarea id="dialogText" name="dialogText" placeholder="Введите уточнение для диалога..." style="flex-grow: 1; min-height: 200px;">${dialogText}</textarea>
            </div>
          </div>
        </div>
        <button type="submit">💾 Сохранить уточнения</button>
      </form>
    `;
  }

  const body = `
      <!DOCTYPE html>
      <html lang="ru" style="height: 100%; margin: 0; padding: 0;">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${pageTitle}</title>
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
          .tabs { display: flex; gap: 5px; margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
          .tab-link { padding: 10px 15px; text-decoration: none; color: #007bff; border: 1px solid transparent; border-bottom: none; border-radius: 5px 5px 0 0; }
          .tab-link.active { color: #333; background: #f9f9f9; border-color: #ddd; border-bottom-color: #f9f9f9; font-weight: bold; }
          .header-container { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px; }
        </style>
      </head>
      <body style="height: 100%; margin: 0; padding: 0; display: flex; flex-direction: column;">
        <div class="header-container">
            <h1>Настройки</h1>
            <div class="tabs">
                ${AVAILABLE_TABS.map(tab =>
                  `<a href="${baseUrl}?view=${tab.key}" class="tab-link ${view === tab.key ? 'active' : ''}">${tab.label}</a>`
                ).join('')}
            </div>
        </div>
        ${formContent}
      </body>
      </html>
    `;

  return {
	statusCode: 200,
	headers: { 'Content-Type': 'text/html; charset=utf-8' },
	body,
  };
}