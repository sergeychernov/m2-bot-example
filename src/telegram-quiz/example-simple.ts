import { Bot } from 'grammy';
import { createTelegramQuiz, memoryStorage, Storage, Callbacks } from './index';

// Пример простого хранилища в JSON файле
const jsonFileStorage: Storage = {
    async load(userId: number) {
        // Здесь была бы загрузка из JSON файла
        console.log(`Loading state for user ${userId}`);
        return null;
    },

    async save(userId: number, state) {
        // Здесь было бы сохранение в JSON файл
        console.log(`Saving state for user ${userId}:`, state);
    },

    async delete(userId: number) {
        // Здесь было бы удаление из JSON файла
        console.log(`Deleting state for user ${userId}`);
    }
};

// Пример простых колбэков
const simpleCallbacks: Callbacks = {
    async onAnswer(ctx, { question, answer, state }) {
        console.log(`User ${ctx.from?.id} answered "${answer}" to question "${question.id}"`);
    },

    async onComplete(ctx, { answers, state }) {
        console.log(`User ${ctx.from?.id} completed quiz with answers:`, answers);
        await ctx.reply('🎉 Спасибо за участие в квизе!');
    },

    async onExit(ctx, { state }) {
        console.log(`User ${ctx.from?.id} exited quiz`);
        await ctx.reply('👋 До свидания!');
    }
};

// Пример конфигурации квиза
const quizConfig = {
    quizDescription: 'Добро пожаловать в наш квиз!',
    questions: [
        {
            id: 'name',
            key: 'userName',
            question: 'Как вас зовут?',
            type: 'text' as const,
            validation: {
                type: 'minLength' as const,
                minLength: 2,
                errorMessage: 'Имя должно содержать минимум 2 символа'
            }
        },
        {
            id: 'age',
            key: 'userAge',
            question: 'Выберите ваш возраст:',
            type: 'buttons' as const,
            options: ['18-25', '26-35', '36-45', '45+']
        },
        {
            id: 'interests',
            key: 'userInterests',
            question: 'Выберите ваши интересы:',
            type: 'multi-select' as const,
            options: ['Спорт', 'Музыка', 'Кино', 'Книги', 'Путешествия'],
            required: true
        }
    ],
    successText: 'Спасибо за участие в квизе!',
    exitText: 'Вы вышли из квиза',
    buttonLabels: {
        exit: 'Выйти',
        next: 'Далее'
    }
};

// Создание экземпляра квиза
export function createSimpleQuiz(bot: Bot) {
    return createTelegramQuiz({
        bot,
        config: quizConfig,
        storage: memoryStorage, // или jsonFileStorage
        callbacks: simpleCallbacks,
        parseMode: 'HTML',
        namespace: 'simple'
    });
}

// Пример использования:
/*
const bot = new Bot('YOUR_BOT_TOKEN');
const quiz = createSimpleQuiz(bot);

// Обработка текстовых сообщений
bot.on('message:text', async (ctx, next) => {
    await quiz.handleText(ctx);
    return next();
});

// Обработка callback query
bot.callbackQuery(/^tq_simple_/, async (ctx) => {
    await quiz.handleCallback(ctx);
});

// Запуск квиза
bot.command('start_quiz', async (ctx) => {
    if (ctx.from?.id) {
        await quiz.start(ctx.from.id, { allowExit: true });
    }
});
*/

