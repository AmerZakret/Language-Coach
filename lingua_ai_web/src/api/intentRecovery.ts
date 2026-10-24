import { mutationRequest } from './mutationRequest';
import apiClient from './apiClient';
import { listOnlineIntents, prepareOnlineIntent, runOnlineIntent } from '../utils/onlineIntents';
import type { IntentKind, OnlineIntent } from '../utils/onlineIntents';
import { invalidateCommunityFeed } from '../utils/communityFeedCache';
import type { QueueSession } from '../utils/queueSession';
import { getSessionRequestConfig, isSessionCurrent } from '../utils/queueSession';
import { releaseCompatibility } from '../utils/releaseCompatibility';

async function dispatch(intent: OnlineIntent, sessionSnapshot: QueueSession) {
  if (!isSessionCurrent(sessionSnapshot)) throw new Error('Mutation session changed');
  return mutationRequest(intent.id, async () => {
  const config = { sessionSnapshot, clientProtocolRevision: intent.protocol,
    headers: { 'X-Idempotency-Key': intent.id } };
  if (intent.kind === 'community-create') {
    const form = new FormData();
    for (const field of ['learningLanguage', 'text']) {
      if (typeof intent.payload[field] === 'string') form.set(field, intent.payload[field] as string);
    }
    const image = intent.payload.image as { name: string; type: string; base64: string } | undefined;
    if (image) {
      const bytes = Uint8Array.from(atob(image.base64), character => character.charCodeAt(0));
      form.set('image', new Blob([bytes], { type: image.type }), image.name);
    }
    return (await apiClient.post('/community/posts', form, { ...config,
      headers: { ...config.headers, 'Content-Type': 'multipart/form-data' } })).data;
  }
  if (intent.kind === 'ai-send') return (await apiClient.post('/ai-coach/chat', intent.payload, config)).data;
  return (await apiClient.delete('/ai-coach/clear', { ...config, params: intent.payload })).data;
  });
}
function accept(result: unknown, intent: OnlineIntent): void {
  if (!result || typeof result !== 'object') throw new Error('The acknowledgement could not be confirmed. Saved action is preserved.');
  const value = result as Record<string, unknown>;
  if (intent.kind === 'community-create') {
    if (typeof value._id !== 'string' || !value._id) throw new Error('Missing post acknowledgement.');
    invalidateCommunityFeed(intent.ownerNamespace, { language: intent.language }, true);
  } else if (intent.kind === 'ai-send') {
    if (typeof value.reply !== 'string') throw new Error('Missing chat acknowledgement.');
  } else if (value.success !== true) throw new Error('Missing clear acknowledgement.');
}
export const replayOnlineIntent = (id: string): Promise<unknown> => runOnlineIntent(id, dispatch, accept);
export async function durableMutation<T>(kind: IntentKind, language: string, payload: Record<string, unknown>, operationId?: string): Promise<T> {
  const intent = await prepareOnlineIntent(kind, language, payload, operationId);
  return await replayOnlineIntent(intent.id) as T;
}
export async function recoverOnlineIntents(kind: 'community' | 'ai', language?: string): Promise<void> {
  const { sessionSnapshot } = getSessionRequestConfig();
  if (!sessionSnapshot.token || releaseCompatibility.snapshot().updateRequired) return;
  const intents = await listOnlineIntents();
  // Bounded snapshot, serial dispatch, original payload/protocol and owner only.
  for (const intent of intents) {
    if (!isSessionCurrent(sessionSnapshot)) return;
    if (!intent.kind.startsWith(kind === 'ai' ? 'ai-' : 'community-') || (language && intent.language !== language)) continue;
    if (intent.state === 'failed') throw new Error('A saved action was rejected or conflicted. Recovery is required before replacing it.');
    if (intent.nextAttemptAt > Date.now()) throw new Error('A previous action is awaiting confirmation. Retry recovery shortly.');
    try { await replayOnlineIntent(intent.id); }
    catch (error) {
      if (!isSessionCurrent(sessionSnapshot)) return;
      // Another tab may have accepted this ID while this tab waited for drain.
      if (!(await listOnlineIntents()).some(item => item.id === intent.id)) continue;
      throw error;
    }
  }
}
export async function communityCreatePayload(form: FormData): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};
  const entries: [string, FormDataEntryValue][] = [];
  form.forEach((value, field) => entries.push([field, value]));
  for (const [field, value] of entries) {
    if (field === 'learningLanguage' || field === 'text') {
      if (typeof value !== 'string') throw new Error('Invalid post field.');
      payload[field] = value;
    } else if (field === 'image' && typeof value !== 'string') {
      if (value.size > 5 * 1024 * 1024) throw new Error('Image exceeds the recovery storage limit. No post was sent.');
      const bytes = new Uint8Array(await value.arrayBuffer());
      let binary = '';
      for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      payload.image = { name: value.name, type: value.type, base64: btoa(binary) };
    } else throw new Error('This post cannot be saved safely. No request was sent.');
  }
  return payload;
}

// Recovery errors pause writes, never the authoritative reads needed to inspect
// an ambiguous outcome. The owner-scoped notice exposes unresolved/failed state.
export async function recoverBeforeRead(kind: 'community' | 'ai', language?: string): Promise<void> {
  const session = getSessionRequestConfig().sessionSnapshot;
  try { await recoverOnlineIntents(kind, language); }
  catch { /* Identity and failure evidence remain in the journal. */ }
  if (!isSessionCurrent(session)) throw new Error('Mutation session changed');
}
