// Names and keys are internal constants, never derived from request/DB error text.
export const CRITICAL_INDEXES = [
  { collection: 'users', id: 'email_1', key: { email: 1 } },
  { collection: 'lessons', id: 'id_1', key: { id: 1 } },
  {
    collection: 'progresses',
    id: 'userId_1_lessonId_1',
    key: { userId: 1, lessonId: 1 },
  },
  {
    collection: 'flashcards',
    id: 'userId_1_targetLanguage_1_targetWord_1',
    key: { userId: 1, targetLanguage: 1, targetWord: 1 },
  },
  {
    collection: 'flashcardoperations',
    id: 'userId_1_operationId_1_operationType_1',
    key: { userId: 1, operationId: 1, operationType: 1 },
  },
  {
    collection: 'progressresets',
    id: 'userId_1_operationId_1',
    key: { userId: 1, operationId: 1 },
  },
  {
    collection: 'mutationreceipts',
    id: 'userId_1_operationType_1_operationId_1',
    key: { userId: 1, operationType: 1, operationId: 1 },
  },
  {
    collection: 'chatbarriers',
    id: 'userId_1_targetLanguage_1',
    key: { userId: 1, targetLanguage: 1 },
  },
  { collection: 'timelinecontrol', id: 'singleton_1', key: { singleton: 1 } },
] as const;

export const PERFORMANCE_INDEXES = [
  { collection: 'flashcards', key: { userId: 1 } },
  { collection: 'chatmessages', key: { userId: 1 } },
  { collection: 'chatmessages', key: { targetLanguage: 1 } },
  {
    collection: 'chatmessages',
    key: { userId: 1, targetLanguage: 1, createdAt: -1 },
  },
] as const;

type IndexDefinition = {
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
  expireAfterSeconds?: unknown;
  collation?: { locale?: string };
};
export type IndexFailure = {
  collection: string;
  index: string;
  code:
    | 'MISSING_INDEX'
    | 'WRONG_INDEX_OPTIONS'
    | 'LEGACY_INDEX_CONFLICT'
    | 'UNSAFE_TTL'
    | 'INDEX_CHECK_FAILED';
};

function sameKey(left: Record<string, unknown>, right: object): boolean {
  return (
    JSON.stringify(Object.entries(left)) ===
    JSON.stringify(Object.entries(right))
  );
}
export function inspectIndexes(
  expected: (typeof CRITICAL_INDEXES)[number],
  indexes: IndexDefinition[],
): IndexFailure[] {
  const failures: IndexFailure[] = [];
  const failure = (code: IndexFailure['code']) =>
    failures.push({
      collection: expected.collection,
      index: expected.id,
      code,
    });
  if (indexes.some((index) => index.expireAfterSeconds !== undefined))
    failure('UNSAFE_TTL');
  if (
    expected.collection === 'flashcards' &&
    indexes.some(
      (index) =>
        index.unique && sameKey(index.key, { userId: 1, targetWord: 1 }),
    )
  )
    failure('LEGACY_INDEX_CONFLICT');
  const candidates = indexes.filter((index) =>
    sameKey(index.key, expected.key),
  );
  if (!candidates.length) failure('MISSING_INDEX');
  else if (
    !candidates.some(
      (index) =>
        index.unique === true &&
        !index.sparse &&
        !index.partialFilterExpression &&
        index.expireAfterSeconds === undefined &&
        (!index.collation || index.collation.locale === 'simple'),
    )
  )
    failure('WRONG_INDEX_OPTIONS');
  return failures;
}
