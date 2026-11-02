import { targetLanguageCode } from './targetLanguage';
import type { TargetLanguageCode } from '../types/language';
// Pick only supported fields and retain empty strings: omission preserves,
// while an explicit empty optional value clears it.
export interface FlashcardMutationPayload {
  targetWord?: string;
  turkishTranslation?: string;
  targetLanguage?: TargetLanguageCode;
  nativeLanguage?: string;
  nativeTranslation?: string;
  exampleSentence?: string;
  note?: string;
}

type FlashcardMutationInput = Omit<FlashcardMutationPayload, 'targetLanguage'> & { targetLanguage?: string };

export function serializeFlashcardMutation(payload: FlashcardMutationInput): FlashcardMutationPayload;
export function serializeFlashcardMutation(payload: FlashcardMutationInput, normalizeLanguage: boolean): FlashcardMutationInput;
export function serializeFlashcardMutation(payload: FlashcardMutationInput, normalizeLanguage = true): FlashcardMutationInput {
  const body: FlashcardMutationInput = {};
  for (const field of ['targetWord', 'turkishTranslation', 'targetLanguage',
    'nativeLanguage', 'nativeTranslation', 'exampleSentence', 'note'] as const) {
    if (payload[field] !== undefined) body[field] = payload[field];
  }
  if (normalizeLanguage && body.targetLanguage !== undefined) body.targetLanguage = targetLanguageCode(body.targetLanguage);
  return body;
}

export const createFlashcardOperationId = (): string =>
  `action_${Date.now()}_${Math.random().toString(36).slice(2)}`;
