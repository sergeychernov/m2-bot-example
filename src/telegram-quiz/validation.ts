import { QuizQuestion } from './types';

export function validateAnswer(input: string, validation?: QuizQuestion['validation']) {
    if (!validation) return { isValid: true as const };
    const fail = (msg?: string) => ({ isValid: false as const, errorMessage: msg || 'Некорректный ввод' });

    switch (validation.type) {
        case 'minLength': 
            return input.length >= (validation.minLength ?? 0) ? { isValid: true as const } : fail(validation.errorMessage);
        case 'maxLength': 
            return input.length <= (validation.maxLength ?? Infinity) ? { isValid: true as const } : fail(validation.errorMessage);
        case 'number': 
            const num = parseFloat(input);
            if (isNaN(num)) return fail(validation.errorMessage);
            if (validation.min !== undefined && num < validation.min) return fail(validation.errorMessage);
            if (validation.max !== undefined && num > validation.max) return fail(validation.errorMessage);
            return { isValid: true as const };
        case 'email': 
            return /^\S+@\S+\.\S+$/.test(input) ? { isValid: true as const } : fail(validation.errorMessage);
        case 'phone': 
            return /^\+?\d{7,15}$/.test(input) ? { isValid: true as const } : fail(validation.errorMessage);
        case 'url': 
            try { 
                new URL(input); 
                return { isValid: true as const }; 
            } catch { 
                return fail(validation.errorMessage); 
            }
        case 'pattern': 
            return validation.pattern && new RegExp(validation.pattern).test(input) ? { isValid: true as const } : fail(validation.errorMessage);
        default: 
            return { isValid: true as const };
    }
}
