import { dataTimeline, isDataTimelineId, TimelineRecoveryRequired } from './dataTimeline';
import { withBrowserLock, withOwnerStorage, ownerLockName } from './browserCoordination';
import { getSessionRequestConfig, isOfflineQueueSessionActive, isSessionCurrent } from './queueSession';
import type { QueueSession } from './queueSession';
import { CLIENT_PROTOCOL_REVISION } from './clientProtocol';
import { releaseCompatibility } from './releaseCompatibility';
import { classifySyncFailure, retryDelay } from './syncRetryPolicy';

export type IntentKind = 'community-create' | 'ai-send' | 'ai-clear';
export interface OnlineIntent {
  schemaVersion: 1 | 2;
  readonly dataTimelineId?: string;
  id: string;
  ownerNamespace: string;
  protocol: number;
  kind: IntentKind;
  language: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'acknowledged' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  category?: string;
  result?: unknown;
}
interface Journal { schemaVersion: 2; ownerNamespace: string; intents: OnlineIntent[] }
export const INTENT_CAPACITY = 8;
export const INTENT_BYTE_LIMIT = 8 * 1024 * 1024;
export class IntentRecoveryRequired extends Error {
  constructor() { super('A previous action needs confirmation or recovery. Saved work is preserved; refresh to recover before trying a different action.'); }
}
const key = (owner: string) => `linguaai_online_intents_${encodeURIComponent(owner)}`;
const listeners = new Set<() => void>();
const acceptedListeners = new Map<string, Set<() => void>>();
export const subscribeIntentAcknowledgements = (owner: string, listener: () => void): (() => void) => {
  const owned = acceptedListeners.get(owner) ?? new Set<() => void>();
  acceptedListeners.set(owner, owned); owned.add(listener);
  const external = (event: StorageEvent) => {
    if (event.key !== key(owner) || !event.oldValue || !event.newValue
      || event.oldValue.length > INTENT_BYTE_LIMIT || event.newValue.length > INTENT_BYTE_LIMIT) return;
    try {
      const before: Journal = JSON.parse(event.oldValue), after: Journal = JSON.parse(event.newValue);
      if (before.ownerNamespace === owner && after.ownerNamespace === owner
        && Array.isArray(before.intents) && Array.isArray(after.intents)
        && before.intents.some(item => !after.intents.some(current => current.id === item.id))) listener();
    } catch { /* Corrupt evidence never causes dispatch or deletion. */ }
  };
  window.addEventListener('storage', external);
  return () => {
    owned.delete(listener); if (!owned.size) acceptedListeners.delete(owner);
    window.removeEventListener('storage', external);
  };
};
export const subscribeOnlineIntents = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const external = (event: StorageEvent) => { if (event.key === null || event.key?.startsWith('linguaai_online_intents_')) listener(); };
  window.addEventListener('storage', external);
  return () => { listeners.delete(listener); window.removeEventListener('storage', external); };
};
function assertSession(session: QueueSession): void {
  if (!isOfflineQueueSessionActive(session)) throw new IntentRecoveryRequired();
}
function validate(intent: OnlineIntent, owner: string): boolean {
  const payload = intent?.payload;
  if (!intent || ![1, 2].includes(intent.schemaVersion) || (intent.dataTimelineId !== undefined && !isDataTimelineId(intent.dataTimelineId))
    || (intent.schemaVersion === 2 && !isDataTimelineId(intent.dataTimelineId)) || intent.ownerNamespace !== owner
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(intent.id) || !Number.isInteger(intent.protocol)
    || intent.protocol < 0 || intent.protocol > 999999 || !['en', 'de', 'es', 'fr', 'ar'].includes(intent.language)
    || !['pending', 'acknowledged', 'failed'].includes(intent.state) || !Number.isInteger(intent.attempts)
    || intent.attempts < 0 || intent.attempts > 10000 || !Number.isFinite(intent.nextAttemptAt)
    || !payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (intent.kind === 'ai-send') return typeof payload.message === 'string' && payload.message.length <= 20000
    && typeof payload.language === 'string' && payload.targetLanguage === intent.language
    && Object.keys(payload).every(field => ['message', 'language', 'targetLanguage'].includes(field));
  if (intent.kind === 'ai-clear') return Object.keys(payload).length === 1 && payload.targetLanguage === intent.language;
  if (intent.kind !== 'community-create' || payload.learningLanguage !== intent.language
    || (payload.text !== undefined && (typeof payload.text !== 'string' || payload.text.length > 20000))
    || !Object.keys(payload).every(field => ['learningLanguage', 'text', 'image'].includes(field))) return false;
  const image = payload.image as { name?: unknown; type?: unknown; base64?: unknown } | undefined;
  return image === undefined || (!!image && typeof image.name === 'string' && image.name.length <= 255
    && typeof image.type === 'string' && /^image\/(png|jpeg|webp)$/.test(image.type)
    && typeof image.base64 === 'string' && image.base64.length <= 7 * 1024 * 1024
    && image.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)
    && image.base64.length / 4 * 3 - (image.base64.endsWith('==') ? 2 : image.base64.endsWith('=') ? 1 : 0) <= 5 * 1024 * 1024);
}
function read(owner: string): Journal {
  const raw = localStorage.getItem(key(owner));
  if (raw === null) return { schemaVersion: 2, ownerNamespace: owner, intents: [] };
  try {
    if (new TextEncoder().encode(raw).length > INTENT_BYTE_LIMIT) throw new Error();
    const journal: Journal = JSON.parse(raw);
    if (![1, 2].includes(journal.schemaVersion) || journal.ownerNamespace !== owner || !Array.isArray(journal.intents)
      || journal.intents.length > INTENT_CAPACITY || journal.intents.some(intent => !validate(intent, owner))
      || new Set(journal.intents.map(intent => intent.id)).size !== journal.intents.length) throw new Error();
    journal.schemaVersion = 2;
    return journal;
  } catch { throw new Error('Pending action storage needs recovery. Existing evidence is preserved; no request was sent.'); }
}
function write(journal: Journal): void {
  const raw = JSON.stringify(journal);
  if (new TextEncoder().encode(raw).length > INTENT_BYTE_LIMIT) throw new Error('Pending action storage is full. Recover saved actions before sending.');
  localStorage.setItem(key(journal.ownerNamespace), raw);
  for (const listener of listeners) listener();
}
export async function listOnlineIntents(): Promise<OnlineIntent[]> {
  const session = getSessionRequestConfig().sessionSnapshot;
  return withOwnerStorage(session.ownerNamespace, () => { assertSession(session); return read(session.ownerNamespace).intents; });
}
export async function prepareOnlineIntent(kind: IntentKind, language: string, payload: Record<string, unknown>, operationId?: string, timeline?: { readonly dataTimelineId: string }): Promise<OnlineIntent> {
  const session = getSessionRequestConfig().sessionSnapshot;
  const operation = timeline ?? dataTimeline.capture();
  const frozen = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  releaseCompatibility.assertMutationAllowed();
  return withOwnerStorage(session.ownerNamespace, () => {
    assertSession(session);
    const journal = read(session.ownerNamespace);
    if (dataTimeline.provenance(operation) !== 'CURRENT') throw new TimelineRecoveryRequired();
    const previous = journal.intents.find(intent => intent.kind === kind && intent.language === language && intent.dataTimelineId === operation.dataTimelineId);
    // A different draft is never permission to abandon an ambiguous operation.
    if (previous) {
      if (JSON.stringify(previous.payload) !== JSON.stringify(frozen) || (operationId && operationId !== previous.id)) throw new IntentRecoveryRequired();
      return previous;
    }
    if (kind.startsWith('ai-') && journal.intents.some(intent => intent.kind.startsWith('ai-') && intent.language === language && intent.dataTimelineId === operation.dataTimelineId)) throw new IntentRecoveryRequired();
    if (operationId && journal.intents.some(intent => intent.id === operationId)) throw new IntentRecoveryRequired();
    if (journal.intents.length >= INTENT_CAPACITY) throw new IntentRecoveryRequired();
    const intent: OnlineIntent = { schemaVersion: 2, ...operation, id: operationId ?? crypto.randomUUID(), ownerNamespace: session.ownerNamespace,
      protocol: CLIENT_PROTOCOL_REVISION, kind, language, payload: frozen, state: 'pending', attempts: 0, nextAttemptAt: 0 };
    if (!validate(intent, session.ownerNamespace)) throw new Error('This action cannot be saved safely. No request was sent.');
    journal.intents.push(intent);
    write(journal);
    console.debug?.('client_intent_created'); // Fixed category only.
    // Mandatory durable boundary before any network dispatch.
    return intent;
  });
}
export async function runOnlineIntent<T>(id: string, dispatch: (intent: OnlineIntent, session: QueueSession) => Promise<T>, accept: (result: T, intent: OnlineIntent) => void | Promise<void>): Promise<T> {
  const session = getSessionRequestConfig().sessionSnapshot;
  const owner = session.ownerNamespace;
  // Share the existing owner drain lock. Reload after acquiring it, including
  // after another tab has acknowledged and removed the operation.
  return withBrowserLock(ownerLockName(owner, 'drain'), async () => {
    assertSession(session);
    await dataTimeline.refresh();
    let intent = await withOwnerStorage(owner, () => read(owner).intents.find(item => item.id === id));
    if (!intent || ['timeline', 'provenance'].includes(intent.category || '') || intent.state === 'failed' || intent.nextAttemptAt > Date.now()) throw new IntentRecoveryRequired();
    if (intent.protocol !== CLIENT_PROTOCOL_REVISION) throw new TimelineRecoveryRequired();
    dataTimeline.assertDispatch(intent);
    releaseCompatibility.assertMutationAllowed();
    const change = async (work: (current: OnlineIntent) => void, authoritative = false) => withOwnerStorage(owner, () => {
      assertSession(session);
      const journal = read(owner);
      const current = journal.intents.find(item => item.id === id);
      if (!current) throw new IntentRecoveryRequired();
      if (authoritative) dataTimeline.assertDispatch(current);
      const provenance = current.dataTimelineId;
      work(current);
      if (current.dataTimelineId !== provenance) throw new TimelineRecoveryRequired();
      write(journal); intent = current;
    });
    let result: T;
    if (intent.state === 'acknowledged') result = intent.result as T;
    else {
      await change(current => { current.attempts = Math.min(10000, current.attempts + 1); });
      try {
        result = await dispatch(intent, session);
        assertSession(session);
        dataTimeline.assertDispatch(intent);
        // Retain both identity and result if application acknowledgement fails.
        await change(current => { current.state = 'acknowledged'; current.result = result; }, true);
      } catch (error) {
        if (isSessionCurrent(session)) {
          const failure = classifySyncFailure(error);
          const rawRetry = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers?.['retry-after'];
          const retryAfter = typeof rawRetry === 'string' && /^\d{1,9}$/.test(rawRetry) ? Math.min(300000, Number(rawRetry) * 1000) : 0;
          await change(current => {
            current.category = failure.category;
            current.state = failure.terminal ? 'failed' : 'pending';
            current.nextAttemptAt = ['authentication', 'compatibility'].includes(failure.category) ? 0 : Date.now() + Math.max(retryAfter, retryDelay(current.attempts));
          });
        }
        throw error;
      }
    }
    assertSession(session);
    dataTimeline.assertDispatch(intent);
    await accept(result, intent);
    await withOwnerStorage(owner, () => {
      assertSession(session);
      const journal = read(owner);
      const acknowledged = journal.intents.find(item => item.id === id);
      if (!acknowledged) throw new IntentRecoveryRequired();
      dataTimeline.assertDispatch(acknowledged);
      journal.intents = journal.intents.filter(item => item.id !== id || item.state !== 'acknowledged');
      write(journal);
    });
    console.debug?.('client_intent_reconciled');
    for (const listener of acceptedListeners.get(owner) ?? []) listener();
    return result;
  });
}

export async function discardOnlineIntent(id: string): Promise<void> {
  const session = getSessionRequestConfig().sessionSnapshot;
  await withOwnerStorage(session.ownerNamespace, () => {
    assertSession(session);
    const journal = read(session.ownerNamespace);
    const selected = journal.intents.find(intent => intent.id === id);
    if (!selected || (dataTimeline.provenance(selected) === 'CURRENT' && !['timeline', 'provenance'].includes(selected.category || ''))) throw new IntentRecoveryRequired();
    journal.intents = journal.intents.filter(intent => intent.id !== id);
    write(journal);
  });
}
