// Pick only supported fields and retain empty strings: omission preserves,
// while an explicit empty optional value clears it.
export interface FlashcardMutationPayload {
  targetWord?: string;
  turkishTranslation?: string;
  targetLanguage?: string;
  nativeLanguage?: string;
  nativeTranslation?: string;
  exampleSentence?: string;
  note?: string;
}

export const serializeFlashcardMutation = (payload: FlashcardMutationPayload): FlashcardMutationPayload => {
  const body: FlashcardMutationPayload = {};
  for (const field of ['targetWord', 'turkishTranslation', 'targetLanguage',
    'nativeLanguage', 'nativeTranslation', 'exampleSentence', 'note'] as const) {
    if (payload[field] !== undefined) body[field] = payload[field];
  }
  return body;
};

export const createFlashcardOperationId = (): string =>
  `action_${Date.now()}_${Math.random().toString(36).slice(2)}`;
