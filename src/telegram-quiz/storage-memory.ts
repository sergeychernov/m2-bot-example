import { Storage, QuizState } from './types';

const memoryStore = new Map<number, QuizState>();

export const memoryStorage: Storage = {
    async load(userId: number): Promise<QuizState | null> {
        return memoryStore.get(userId) || null;
    },

    async save(userId: number, state: QuizState): Promise<void> {
        memoryStore.set(userId, state);
    },

    async delete(userId: number): Promise<void> {
        memoryStore.delete(userId);
    }
};
