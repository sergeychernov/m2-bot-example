import { addPrompt, saveQuizConfig, updatePromptDetails } from './ydb';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import quizSchema from './quiz-schema.json';

function validateQuizConfig(quizConfig: any): { isValid: boolean; errors?: string[] } {
  if (!quizConfig || Object.keys(quizConfig).length === 0) {
    return { isValid: true };
  }

  const ajv = new Ajv();
  addFormats(ajv);
  const validate = ajv.compile(quizSchema);
  
  if (!validate(quizConfig)) {
    const errors = validate.errors?.map(error => {
      const path = error.instancePath || 'root';
      return `${path}: ${error.message}`;
    }) || [];
    return { isValid: false, errors };
  }
  
  return { isValid: true };
}

export async function handleSettingsPost(event: any): Promise<any> {
  let bodyString = Buffer.from(event.body, 'base64').toString('utf-8');

  if (bodyString) {
    const params = new URLSearchParams(bodyString);
    const formType = params.get('formType');

    if (formType === 'base' || formType === 'summary') {
      const promptText = params.get('promptText')?.replace(/\r\n/g, '\n') || '';
      const greetingText = params.get('greetingText')?.replace(/\r\n/g, '\n') || '';
      const dialogText = params.get('dialogText')?.replace(/\r\n/g, '\n') || '';
      const model = params.get('model') || '/yandexgpt-lite/latest';
      const temperatureStr = params.get('temperature');
      const temperature = temperatureStr ? parseFloat(temperatureStr) : 0.6;
      const maxTokensStr = params.get('maxTokens');
      const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : 20000;
      const stream = params.get('stream') === 'on';

      await addPrompt(promptText, formType, model, stream, temperature, maxTokens);
    } else if (formType === 'promptDetails') {
      const greetingText = params.get('greetingText')?.replace(/\r\n/g, '\n') || '';
      const dialogText = params.get('dialogText')?.replace(/\r\n/g, '\n') || '';
      await updatePromptDetails('base', greetingText, dialogText);
    } else if (formType === 'quiz') {
      const quizConfigStr = params.get('quizConfig') || '';
      let quizConfig = {};

      if (quizConfigStr) {
        try {
          quizConfig = JSON.parse(quizConfigStr);
        } catch (error) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: 'Invalid JSON format for quiz configuration.',
          };
        }
      }

      const validationResult = validateQuizConfig(quizConfig);
      if (!validationResult.isValid) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: `
            <html>
              <head>
                <title>Ошибка валидации квиза</title>
                <style>
                  body {
                    font-family: Arial, sans-serif;
                    max-width: 600px;
                    margin: 50px auto;
                    padding: 20px;
                    background: #f5f5f5;
                  }
                  .error-message {
                    background: #f8d7da;
                    border: 1px solid #f5c6cb;
                    border-radius: 8px;
                    padding: 20px;
                    color: #721c24;
                    text-align: center;
                  }
                  .error-message h2 {
                    margin-top: 0;
                    color: #721c24;
                  }
                  .error-list {
                    background: white;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    padding: 15px;
                    margin: 15px 0;
                    text-align: left;
                  }
                  .error-list ul {
                    margin: 0;
                    padding-left: 20px;
                  }
                  .error-list li {
                    margin-bottom: 8px;
                    color: #721c24;
                  }
                  .back-button {
                    background: #007bff;
                    color: white;
                    padding: 12px 24px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 16px;
                    text-decoration: none;
                    display: inline-block;
                    margin-top: 20px;
                  }
                  .back-button:hover {
                    background: #0056b3;
                  }
                </style>
              </head>
              <body>
                <div class="error-message">
                  <h2>❌ Ошибка валидации квиза!</h2>
                  <p>Следующие ошибки были обнаружены в конфигурации:</p>
                  <div class="error-list">
                    <ul>
                      ${validationResult.errors?.map(error => `<li>${error}</li>`).join('')}
                    </ul>
                  </div>
                  <p><strong>Исправьте ошибки и попробуйте сохранить снова.</strong></p>
                  <a href="${event.url}" class="back-button">← Вернуться к настройкам</a>
                </div>
              </body>
            </html>
          `,
        };
      }

      await saveQuizConfig(quizConfig);
    }
  }

  const formUrl = event.url;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `
      <html>
        <head>
          <meta http-equiv="refresh" content="3;url=${formUrl}">
          <title>Настройки сохранены</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
              background: #f5f5f5;
            }
            .success-message {
              background: #d4edda;
              border: 1px solid #c3e6cb;
              border-radius: 8px;
              padding: 20px;
              color: #155724;
              text-align: center;
            }
            .success-message h2 {
              margin-top: 0;
              color: #155724;
            }
            .redirect-link {
              margin-top: 20px;
              text-align: center;
            }
            .redirect-link a {
              color: #007bff;
              text-decoration: none;
            }
            .redirect-link a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="success-message">
            <h2>✅ Настройки успешно сохранены!</h2>
            <p>Все изменения применены и сохранены в базе данных.</p>
            <div class="redirect-link">
              <p>Вы будете перенаправлены обратно через 3 секунды.</p>
              <p>Если автоматическое перенаправление не работает, <a href="${formUrl}">нажмите сюда</a>.</p>
            </div>
          </div>
        </body>
      </html>
    `,
  };
}