import { Context, InlineKeyboard } from 'grammy';
import { formatProfileMarkdownV2 } from "./telegram-utils";

// Добавляем тип для сессии
interface QuizSessionData {
  selectedOptions: Record<string, string[]>;
}

export type QuizQuestion = {
  id: string;
  key: string;
  question: string;
  type: 'text' | 'buttons' | 'multi-select';
  options?: string[];
  required?: boolean;
  imageUrl?: string;
  validation?: QuestionValidation;
};

type QuestionValidation = {
  type: 'email' | 'phone' | 'url' | 'number' | 'minLength' | 'maxLength' | 'pattern' | 'custom';
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  errorMessage?: string;
};

export type QuizConfig = {
  quizDescription?: string;
  exitText?: string;
  successText?: string;
  buttonLabels?: {
    exit?: string;
  };
  questions: QuizQuestion[];
};

export type QuizCallbacks = {
  loadQuizStep: (userId: number) => Promise<number | null>;
  saveQuizStep: (userId: number, step: number) => Promise<void>;
  onQuizStart?: (userId: number) => void;
  onQuizAnswer?: (userId: number, questionId: string, answer: any) => Promise<void>;
  onQuizEnd?: (userId: number) => void;
};

export class Quiz {
  private currentAnswers: Record<string, any> = {};
  private keyboardCache = new Map<string, InlineKeyboard>();

  constructor(
      private readonly config: QuizConfig,
      private readonly callbacks: QuizCallbacks,
      private readonly ctx: Context & { session?: QuizSessionData }
  ) {}

  public async startQuiz(): Promise<void> {
    const userId = this.getUserId();
    if (!userId) return;

    // Инициализируем сессию
    this.initSession();

    // Сбрасываем текущие ответы
    this.currentAnswers = {};
    this.keyboardCache.clear();

    // Загружаем текущий шаг или начинаем с начала
    const step = await this.callbacks.loadQuizStep(userId) ?? 0;
    await this.callbacks.saveQuizStep(userId, step);

    this.callbacks.onQuizStart?.(userId);

    if (this.config.quizDescription) {
      await this.sendMessage(this.config.quizDescription);
    }

    await this.sendQuestion(step);
  }

  private initSession() {
    if (!this.ctx.session) {
      this.ctx.session = { selectedOptions: {} };
    } else if (!this.ctx.session.selectedOptions) {
      this.ctx.session.selectedOptions = {};
    }
  }

  public async handleTextAnswer(): Promise<void> {
    const userId = this.getUserId();
    if (!userId || !this.ctx.message?.text) return;

    const step = await this.callbacks.loadQuizStep(userId) ?? 0;
    const question = this.config.questions[step];

    if (!question || question.type !== 'text') {
      console.error(`Question not found or wrong type at step ${step}`);
      return;
    }

    const text = this.ctx.message.text.trim();
    const validation = this.validateAnswer(text, question.validation);

    if (!validation.isValid) {
      await this.sendMessage(validation.errorMessage || '⚠️ Неверный формат ответа');
      return;
    }

    this.currentAnswers[question.id] = text;
    if (this.callbacks.onQuizAnswer) {
      await this.callbacks.onQuizAnswer(userId, question.id, text);
    }

    const nextStep = step + 1;
    await this.callbacks.saveQuizStep(userId, nextStep);
    await this.proceedToNextStep(nextStep);
  }

  public async handleButtonAction(): Promise<void> {
    const userId = this.getUserId();
    if (!userId || !this.ctx.callbackQuery?.data) return;

    await this.ctx.answerCallbackQuery();
    const step = await this.callbacks.loadQuizStep(userId) ?? 0;
    const question = this.config.questions[step];

    if (!question || question.type !== 'buttons') {
      console.error(`Question not found or wrong type at step ${step}`);
      return;
    }

    const match = this.ctx.callbackQuery.data.match(/^quiz_button_(.+?)_(.+)$/);
    if (!match || match[1] !== question.id) return;

    const answer = match[2];
    this.currentAnswers[question.id] = answer;

    if (this.callbacks.onQuizAnswer) {
      await this.callbacks.onQuizAnswer(userId, question.id, answer);
    }

    const nextStep = step + 1;
    await this.callbacks.saveQuizStep(userId, nextStep);
    await this.proceedToNextStep(nextStep);
  }

  public async handleMultiSelectAction(): Promise<void> {
    const userId = this.getUserId();
    if (!userId || !this.ctx.callbackQuery?.data) return;

    await this.ctx.answerCallbackQuery();
    const step = await this.callbacks.loadQuizStep(userId) ?? 0;
    const question = this.config.questions[step];

    if (!question || question.type !== 'multi-select') {
      console.error(`Wrong question type at step ${step}`);
      return;
    }

    const callbackData = this.ctx.callbackQuery.data;
    const isDoneAction = callbackData.startsWith('quiz_multi_done_');
    const isSelectAction = callbackData.startsWith(`quiz_multi_${question.id}_`);

    if (isSelectAction) {
      const option = callbackData.split('_')[3];
      let selected = this.ctx.session?.selectedOptions?.[question.id] || [];

      selected = selected.includes(option)
          ? selected.filter(o => o !== option)
          : [...selected, option];

      this.ctx.session!.selectedOptions = {
        ...this.ctx.session?.selectedOptions,
        [question.id]: selected
      };

      await this.updateKeyboard(question, selected);
      return;
    }

    if (isDoneAction) {
      const selected = this.ctx.session?.selectedOptions?.[question.id] || [];

      if (question.required && selected.length === 0) {
        await this.ctx.answerCallbackQuery({ text: "⚠️ Выберите хотя бы один вариант!" });
        return;
      }

      this.currentAnswers[question.id] = selected;

      if (this.callbacks.onQuizAnswer) {
        await this.callbacks.onQuizAnswer(userId, question.id, selected);
      }

      const nextStep = step + 1;
      await this.callbacks.saveQuizStep(userId, nextStep);
      await this.proceedToNextStep(nextStep);
    }
  }

  private async updateKeyboard(question: QuizQuestion, selected: string[]): Promise<void> {
    const cacheKey = `${question.id}_${selected.sort().join(',')}`;

    if (!this.keyboardCache.has(cacheKey)) {
      const keyboard = new InlineKeyboard();

      question.options?.forEach(option => {
        keyboard.text(
            `${selected.includes(option) ? "✅" : "◻️"} ${option}`,
            `quiz_multi_${question.id}_${option}`
        ).row();
      });

      keyboard.text("➡️ Готово", `quiz_multi_done_${question.id}`);
      this.keyboardCache.set(cacheKey, keyboard);
    }

    const keyboard = this.keyboardCache.get(cacheKey);

    if (keyboard && this.ctx.chat?.id && this.ctx.callbackQuery?.message?.message_id) {
      await this.ctx.api.editMessageReplyMarkup(
          this.ctx.chat.id,
          this.ctx.callbackQuery.message.message_id,
          { reply_markup: keyboard }
      );
    }
  }

  public async handleExitAction(): Promise<void> {
    const userId = this.getUserId();
    if (!userId) return;

    await this.ctx.answerCallbackQuery();
    this.callbacks.onQuizEnd?.(userId);

    if (this.config.exitText) {
      await this.sendMessage(this.config.exitText);
    }
  }

  // Вспомогательные методы
  private async sendQuestion(step: number): Promise<void> {
    const question = this.config.questions[step];
    if (!question) return;

    const keyboard = this.createKeyboard(question, step);
    const options = {
      reply_markup: keyboard?.inline_keyboard.length ? keyboard : undefined,
      parse_mode: 'HTML' as const
    };

    if (question.imageUrl) {
      await this.ctx.api.sendPhoto(this.getUserId()!, question.imageUrl, {
        caption: question.question,
        ...options
      });
    } else {
      await this.sendMessage(question.question, options);
    }
  }

  private createKeyboard(question: QuizQuestion, step: number): InlineKeyboard | undefined {
    const keyboard = new InlineKeyboard();

    if (question.type === 'buttons') {
      question.options?.forEach(option =>
          keyboard.text(option, `quiz_button_${question.id}_${option}`).row()
      );
    }
    else if (question.type === 'multi-select') {
      const selected = this.getSelectedOptions(question.id);
      question.options?.forEach(option =>
          keyboard.text(
              `${selected.includes(option) ? "✅" : " "} ${option}`,
              `quiz_multi_${question.id}_${option}`
          ).row()
      );
      keyboard.text("➡️ Готово", `quiz_multi_done_${question.id}`);
    }

    // Добавляем кнопку выхода, если она есть в конфиге
    if (this.config.buttonLabels?.exit) {
      keyboard.text(this.config.buttonLabels.exit, 'quiz_exit').row();
    }

    return keyboard;
  }

  private async proceedToNextStep(step: number): Promise<void> {
    if (step < this.config.questions.length) {
      await this.sendQuestion(step);
    } else {
      await this.showResults();
      await this.callbacks.onQuizEnd?.(this.getUserId()!);
    }
  }

  private async showResults(): Promise<void> {
    const userId = this.getUserId();
    if (!userId) return;

    const profileForDisplay: Record<string, any> = {};
    for (const q of this.config.questions) {
      if (this.currentAnswers[q.id] !== undefined) {
        profileForDisplay[q.key] = this.currentAnswers[q.id];
      }
    }

    if (this.config.successText) {
      await this.sendMessage(this.config.successText);
    }

    const result = formatProfileMarkdownV2(profileForDisplay);
    try {
      await this.sendMessage(result, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('Ошибка при отправке MarkdownV2:', e, 'Текст:', result);
    }
  }

  private getSelectedOptions(questionId: string): string[] {
    const answer = this.currentAnswers[questionId];
    console.log('OOOOOOOO');
    console.log(this.currentAnswers);
    return Array.isArray(answer) ? answer : [];
  }

  private getUserId(): number | undefined {
    return this.ctx.from?.id;
  }

  private validateAnswer(answer: string, validation?: QuizQuestion['validation']): { isValid: boolean; errorMessage?: string } {
    if (!validation) return { isValid: true };

    const { type, pattern, minLength, maxLength, min, max, errorMessage } = validation;

    switch (type) {
      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(answer)) {
          return {
            isValid: false,
            errorMessage: errorMessage || 'Пожалуйста, введите корректный email адрес'
          };
        }
        break;

      case 'phone':
        const phoneRegex = /^[\+]?[0-9\s\-\(\)]{10,}$/;
        if (!phoneRegex.test(answer)) {
          return {
            isValid: false,
            errorMessage: errorMessage || 'Пожалуйста, введите корректный номер телефона'
          };
        }
        break;

      case 'url':
        try {
          new URL(answer);
        } catch {
          return {
            isValid: false,
            errorMessage: errorMessage || 'Пожалуйста, введите корректный URL'
          };
        }
        break;

      case 'number':
        const num = parseFloat(answer);
        if (isNaN(num)) {
          return {
            isValid: false,
            errorMessage: errorMessage || 'Пожалуйста, введите число'
          };
        }
        if (min !== undefined && num < min) {
          return {
            isValid: false,
            errorMessage: errorMessage || `Число должно быть не меньше ${min}`
          };
        }
        if (max !== undefined && num > max) {
          return {
            isValid: false,
            errorMessage: errorMessage || `Число должно быть не больше ${max}`
          };
        }
        break;

      case 'minLength':
        if (minLength !== undefined && answer.length < minLength) {
          return {
            isValid: false,
            errorMessage: errorMessage || `Ответ должен содержать минимум ${minLength} символов`
          };
        }
        break;

      case 'maxLength':
        if (maxLength !== undefined && answer.length > maxLength) {
          return {
            isValid: false,
            errorMessage: errorMessage || `Ответ должен содержать максимум ${maxLength} символов`
          };
        }
        break;

      case 'pattern':
        if (pattern) {
          const regex = new RegExp(pattern);
          if (!regex.test(answer)) {
            return {
              isValid: false,
              errorMessage: errorMessage || 'Ответ не соответствует требуемому формату'
            };
          }
        }
        break;
    }

    return { isValid: true };
  }

  private async sendMessage(text: string, options?: any): Promise<void> {
    try {
      const userId = this.getUserId();
      if (!userId) return;
      await this.ctx.api.sendMessage(userId, text, options);
    } catch (error) {
      console.error('Ошибка отправки сообщения:', error);
    }
  }
}