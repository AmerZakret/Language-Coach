export const REPLAY_TIMEOUT_MS = 45_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 300_000;
export interface RetryState {
  readonly attemptCount?: number;
  readonly lastAttemptAt?: string;
  readonly nextAttemptAt?: string;
  readonly lastErrorCategory?: string;
  readonly lastErrorCode?: string;
  readonly lastErrorStatus?: number;
  readonly failedAt?: string;
  readonly reconciledAt?: string;
  readonly acknowledgedEpoch?: number;
}
export class InvalidQueuedPayload extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}
export function classifySyncFailure(error: any): { category: string; terminal: boolean; code?: string; status?: number } {
  const status = error?.response?.status;
  const rawCode = error instanceof InvalidQueuedPayload ? error.code : error?.response?.data?.code;
  const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode) ? rawCode : undefined;
  const known: Record<string, string> = { STALE_PROGRESS_EPOCH: 'stale-epoch', FUTURE_PROGRESS_EPOCH: 'future-epoch',
    STALE_RESET_EPOCH: 'stale-reset-epoch', FUTURE_RESET_EPOCH: 'future-reset-epoch',
    RESET_IDEMPOTENCY_CONFLICT: 'reset-key-conflict', MISSING_PROGRESS_EPOCH: 'missing-epoch', INVALID_PROGRESS_EPOCH: 'invalid-epoch' };
  if ((error instanceof InvalidQueuedPayload || [400, 409].includes(status)) && code && known[code])
    return { category: known[code], terminal: true, code, status };
  if (error instanceof InvalidQueuedPayload) return { category: 'malformed', terminal: true, code };
  const result = classifyStatus();
  return { ...result, code, status };
  function classifyStatus(): { category: string; terminal: boolean } {
  if (status === 401) return { category: 'authentication', terminal: false };
  if (status === 403) return { category: 'forbidden', terminal: true };
  if (status === 404) return { category: 'not-found', terminal: true };
  if (status === 409) return { category: 'conflict', terminal: true };
  if ([408, 425, 429].includes(status)) return { category: status === 429 ? 'rate-limited' : 'timeout', terminal: false };
  if (status >= 400 && status < 500) return { category: 'validation', terminal: true };
  if (status >= 500) return { category: 'backend', terminal: false };
  if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error?.code)) return { category: 'timeout', terminal: false };
  return { category: 'network', terminal: false };
  }
}
export const retryDelay = (attempt: number): number => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(6, Math.max(0, attempt - 1)));

// Bound the entire replay, including connection establishment. Axios also gets
// a response timeout; AbortController closes the outstanding transport.
export async function withReplayTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeout = REPLAY_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Replay timed out'), { code: 'ETIMEDOUT' }));
    }, timeout);
  });
  try { return await Promise.race([work(controller.signal), deadline]); }
  finally { clearTimeout(timer!); }
}
