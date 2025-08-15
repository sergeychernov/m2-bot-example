export type QuizQuestion = {
    id: string;
    key: string;
    question: string;
    type: 'text' | 'buttons' | 'multi-select';
    options?: string[];
    required?: boolean;
    imageUrl?: string;
    validation?: {
        type: 'email' | 'phone' | 'url' | 'number' | 'minLength' | 'maxLength' | 'pattern' | 'custom';
        pattern?: string;
        minLength?: number;
        maxLength?: number;
        min?: number;
        max?: number;
        errorMessage?: string;
    };
};

export type QuizConfig = {
    quizDescription?: string;
    exitText?: string;
    successText?: string;
    buttonLabels?: { 
        exit?: string; 
        next?: string; 
    };
    questions: QuizQuestion[];
};

export type QuizState = {
    step: number;
    answers: Record<string, any>;
    allowExit: boolean;
    context?: Record<string, any>;
};

export interface Storage {
    load(userId: number): Promise<QuizState | null>;
    save(userId: number, state: QuizState): Promise<void>;
    delete(userId: number): Promise<void>;
}

export interface Callbacks {
    onAnswer?(ctx: any, params: { question: QuizQuestion; answer: any; state: QuizState }): Promise<void> | void;
    onComplete?(ctx: any, params: { answers: Record<string, any>; state: QuizState }): Promise<void> | void;
    onExit?(ctx: any, params: { state: QuizState }): Promise<void> | void;
    validateCustom?(
        ctx: any,
        params: { question: QuizQuestion; input: string; state: QuizState }
    ): Promise<{ isValid: boolean; errorMessage?: string }>;
}
