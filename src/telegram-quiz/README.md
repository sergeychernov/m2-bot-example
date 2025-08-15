# Telegram Quiz Library

Гибкая библиотека для создания интерактивных квизов в Telegram ботах с использованием Grammy.

## Особенности

- 🎯 **Простота использования** - минимальная настройка для быстрого старта
- 🔧 **Гибкость** - кастомные колбэки и валидация
- 💾 **Адаптивное хранилище** - поддержка различных баз данных через интерфейс Storage
- 📱 **Полная поддержка Telegram** - кнопки, мультивыбор, валидация
- 🎨 **Кастомизация** - настройка текстов, кнопок, форматов сообщений
- 🚫 **Нет зависимостей от БД** - библиотека не знает о конкретных базах данных

## Установка

```bash
npm install telegram-quiz
```

## Быстрый старт

```typescript
import { Bot } from 'grammy';
import { createTelegramQuiz, memoryStorage } from 'telegram-quiz';

const bot = new Bot('YOUR_BOT_TOKEN');

const quiz = createTelegramQuiz({
  bot,
  config: {
    quizDescription: 'Добро пожаловать в наш квиз!',
    questions: [
      {
        id: 'name',
        key: 'userName',
        question: 'Как вас зовут?',
        type: 'text',
        validation: {
          type: 'minLength',
          minLength: 2,
          errorMessage: 'Имя должно содержать минимум 2 символа'
        }
      },
      {
        id: 'age',
        key: 'userAge',
        question: 'Выберите ваш возраст:',
        type: 'buttons',
        options: ['18-25', '26-35', '36-45', '45+']
      },
      {
        id: 'interests',
        key: 'userInterests',
        question: 'Выберите ваши интересы:',
        type: 'multi-select',
        options: ['Спорт', 'Музыка', 'Кино', 'Книги', 'Путешествия'],
        required: true
      }
    ],
    successText: 'Спасибо за участие в квизе!'
  },
  storage: memoryStorage,
  parseMode: 'HTML'
});

// Обработка текстовых сообщений
bot.on('message:text', async (ctx, next) => {
  await quiz.handleText(ctx);
  return next();
});

// Обработка callback query
bot.callbackQuery(/^tq_quiz_/, async (ctx) => {
  await quiz.handleCallback(ctx);
});

// Запуск квиза
bot.command('start_quiz', async (ctx) => {
  if (ctx.from?.id) {
    await quiz.start(ctx.from.id, { allowExit: true });
  }
});
```

## Конфигурация

### QuizConfig

```typescript
type QuizConfig = {
  quizDescription?: string;        // Описание квиза
  exitText?: string;              // Текст при выходе
  successText?: string;           // Текст при завершении
  buttonLabels?: {                // Лейблы кнопок
    exit?: string;
    next?: string;
  };
  questions: QuizQuestion[];      // Вопросы
};
```

### QuizQuestion

```typescript
type QuizQuestion = {
  id: string;                     // Уникальный ID вопроса
  key: string;                    // Ключ для сохранения ответа
  question: string;               // Текст вопроса
  type: 'text' | 'buttons' | 'multi-select';
  options?: string[];             // Варианты ответов
  required?: boolean;             // Обязательный вопрос
  imageUrl?: string;              // URL изображения
  validation?: ValidationRule;    // Правила валидации
};
```

## Валидация

Поддерживаются следующие типы валидации:

- `email` - проверка email адреса
- `phone` - проверка номера телефона
- `url` - проверка URL
- `number` - проверка числа с опциональными min/max
- `minLength` - минимальная длина
- `maxLength` - максимальная длина
- `pattern` - регулярное выражение
- `custom` - кастомная валидация через колбэк

## Хранилище

Библиотека предоставляет интерфейс `Storage` для интеграции с любой базой данных:

```typescript
interface Storage {
  load(userId: number): Promise<QuizState | null>;
  save(userId: number, state: QuizState): Promise<void>;
  delete(userId: number): Promise<void>;
}
```

### Встроенные хранилища

- `memoryStorage` - in-memory хранилище (для тестирования)

### Пример интеграции с базой данных

```typescript
import { Storage, QuizState } from 'telegram-quiz';

const myStorage: Storage = {
  async load(userId: number) {
    // Загрузка из вашей БД
    const state = await db.quizStates.findByUserId(userId);
    return state ? {
      step: state.step,
      answers: state.answers,
      allowExit: state.allowExit,
      context: state.context
    } : null;
  },

  async save(userId: number, state: QuizState) {
    // Сохранение в вашу БД
    await db.quizStates.upsert({ userId, ...state });
  },

  async delete(userId: number) {
    // Удаление из вашей БД
    await db.quizStates.deleteByUserId(userId);
  }
};
```

### Пример адаптера для PostgreSQL

```typescript
import { Storage, QuizState } from 'telegram-quiz';
import { Pool } from 'pg';

const pool = new Pool({ /* ваши настройки */ });

const postgresStorage: Storage = {
  async load(userId: number) {
    const result = await pool.query(
      'SELECT step, answers, allow_exit FROM quiz_states WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      step: row.step,
      answers: row.answers,
      allowExit: row.allow_exit,
      context: {}
    };
  },

  async save(userId: number, state: QuizState) {
    await pool.query(
      `INSERT INTO quiz_states (user_id, step, answers, allow_exit) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (user_id) 
       DO UPDATE SET step = $2, answers = $3, allow_exit = $4`,
      [userId, state.step, state.answers, state.allowExit]
    );
  },

  async delete(userId: number) {
    await pool.query('DELETE FROM quiz_states WHERE user_id = $1', [userId]);
  }
};
```

## Колбэки

Библиотека поддерживает кастомные колбэки для расширения функциональности:

```typescript
interface Callbacks {
  onAnswer?(ctx, params): Promise<void> | void;      // При ответе на вопрос
  onComplete?(ctx, params): Promise<void> | void;    // При завершении квиза
  onExit?(ctx, params): Promise<void> | void;        // При выходе из квиза
  validateCustom?(ctx, params): Promise<ValidationResult>; // Кастомная валидация
}
```

### Пример использования колбэков

```typescript
const quiz = createTelegramQuiz({
  bot,
  config: quizConfig,
  callbacks: {
    async onAnswer(ctx, { question, answer, state }) {
      console.log(`Пользователь ${ctx.from?.id} ответил на вопрос ${question.id}: ${answer}`);
    },

    async onComplete(ctx, { answers, state }) {
      await saveToDatabase(ctx.from?.id, answers);
      await sendWelcomeEmail(ctx.from?.id);
    },

    async validateCustom(ctx, { question, input, state }) {
      if (question.id === 'email' && input.includes('spam')) {
        return { isValid: false, errorMessage: 'Спам-адреса не принимаются' };
      }
      return { isValid: true };
    }
  }
});
```

## API

### createTelegramQuiz(options)

Создает экземпляр квиза.

**Параметры:**
- `bot: Bot` - экземпляр Grammy бота
- `config: QuizConfig` - конфигурация квиза
- `storage?: Storage` - хранилище (по умолчанию memoryStorage)
- `callbacks?: Callbacks` - кастомные колбэки
- `parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown'` - режим парсинга
- `namespace?: string` - пространство имен для callback data

**Возвращает:**
```typescript
{
  start(userId, options?): Promise<void>;           // Запуск квиза
  handleText(ctx): Promise<void>;                   // Обработка текста
  handleCallback(ctx): Promise<void>;               // Обработка callback
  exit(ctx): Promise<void>;                         // Выход из квиза
  reset(userId): Promise<void>;                     // Сброс состояния
  patterns: { BTN_PREFIX, MULTI_PREFIX, MULTI_NEXT, EXIT } // Паттерны callback data
}
```

## Принципы дизайна

### Разделение ответственности

Библиотека **НЕ** содержит:
- Логику работы с конкретными базами данных
- Бизнес-логику приложения
- Специфичные для проекта колбэки

Библиотека **СОДЕРЖИТ**:
- Логику управления состоянием квиза
- Обработку Telegram API
- Валидацию ответов
- Универсальные интерфейсы

### Адаптеры

Для интеграции с вашей инфраструктурой создавайте адаптеры:

```typescript
// quiz-adapters.ts
import { Storage, Callbacks } from 'telegram-quiz';
import { yourDatabase, yourBusinessLogic } from './your-app';

export const yourStorage: Storage = {
  // Ваша реализация
};

export function createYourCallbacks(): Callbacks {
  return {
    // Ваши колбэки
  };
}
```

## Лицензия

MIT
