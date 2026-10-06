export const REPLAY_TIMEOUT_MS = 45_000;
export const RETRY_BASE_MS = 5_000;
export const RETRY_MAX_MS = 300_000;
export interface RetryState {
  readonly attemptCount?: number;
  readonly lastAttemptAt?: string;
  readonly nextAttemptAt?: string;
  readonly lastErrorCategory?: string;
  readonly failedAt?: string;
}
export class InvalidQueuedPayload extends Error {}
export function classifySyncFailure(error: any): { category: string; terminal: boolean } {
  if (error instanceof InvalidQueuedPayload) return { category: 'malformed', terminal: true };
  const status = error?.response?.status;
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
