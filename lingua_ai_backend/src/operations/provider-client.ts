import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ProviderBudget,
  ProviderKind,
  withProviderBudget,
} from '../security/provider-budget';
import { OUTPUT_TOKENS } from '../security/abuse-policy';
import { telemetry, sizeBucket } from './telemetry';

export type ProviderCode =
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_CONFIGURATION'
  | 'PROVIDER_INVALID_RESPONSE'
  | 'PROVIDER_REJECTED';
export class ProviderFailure extends HttpException {
  constructor(
    readonly code: ProviderCode,
    readonly retryable: boolean,
    readonly retryAfter?: number,
    readonly retryDelayMs?: number,
    statusOverride?: 502,
  ) {
    super(
      { code, message: 'Provider operation could not be completed.' },
      statusOverride ??
        (code === 'PROVIDER_INVALID_RESPONSE' || code === 'PROVIDER_REJECTED'
          ? 502
          : 503),
    );
  }
}
const defaults: Record<ProviderKind, number> = {
  chat: 35000,
  writing: 30000,
  flashcard: 15000,
  feedback: 8000,
  pronunciation: 45000,
};
export function providerTimeout(
  config: Pick<ConfigService, 'get'>,
  kind: ProviderKind,
): number {
  const value = Number(
    config.get(`PROVIDER_${kind.toUpperCase()}_TIMEOUT_MS`) ?? defaults[kind],
  );
  if (
    !Number.isInteger(value) ||
    value < 500 ||
    value > (kind === 'pronunciation' ? 90000 : 60000)
  )
    throw new ProviderFailure('PROVIDER_CONFIGURATION', false);
  return value;
}
function retryDelay(value: string | null | undefined): number | undefined {
  if (!value || value.length > 64) return undefined;
  const ms = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}
// Bound JSON bytes as well as tokens/deadlines, including the internal transcriber.
// Native Response streams take this path; minimal isolated test doubles use json().
async function boundedJson(response: Response): Promise<any> {
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  const chunks: string[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 256 * 1024) {
        void reader.cancel().catch(() => {});
        throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(''));
  } finally {
    reader.releaseLock();
  }
}
export async function providerJson(
  config: Pick<ConfigService, 'get'>,
  budget: ProviderBudget | undefined,
  kind: ProviderKind,
  url: string,
  init: RequestInit,
): Promise<any> {
  const timeoutMs = providerTimeout(config, kind);
  const retries = Number(config.get('PROVIDER_MAX_RETRIES') ?? 0);
  if (![0, 1].includes(retries))
    throw new ProviderFailure('PROVIDER_CONFIGURATION', false);
  const end = performance.now() + timeoutMs;
  const signal = telemetry.context.getStore()?.signal;
  for (let attempt = 1; ; attempt++) {
    const started = performance.now();
    try {
      const result = await withProviderBudget(budget, kind, async () => {
        const remaining = end - performance.now();
        if (remaining <= 0) throw new ProviderFailure('PROVIDER_TIMEOUT', true);
        const controller = new AbortController();
        let timer: NodeJS.Timeout | undefined;
        let cancel: (() => void) | undefined;
        const aborted = new Promise<never>((_, reject) => {
          cancel = () => {
            reject(new ProviderFailure('PROVIDER_UNAVAILABLE', true));
            controller.abort();
          };
          signal?.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => {
            reject(new ProviderFailure('PROVIDER_TIMEOUT', true));
            controller.abort();
          }, remaining);
          if (signal?.aborted) cancel();
        });
        telemetry.emit('provider.started', {
          dependency: kind,
          attempt,
          timeoutMs: Math.ceil(remaining),
          outputTokenLimit:
            kind === 'pronunciation' ? undefined : OUTPUT_TOKENS[kind],
          inputBucket:
            typeof init.body === 'string'
              ? sizeBucket(Buffer.byteLength(init.body))
              : 'multipart_bounded',
        });
        const work = async () => {
          if (signal?.aborted)
            throw new ProviderFailure('PROVIDER_UNAVAILABLE', true);
          const headers = new Headers(init.headers);
          const requestId = telemetry.context.getStore()?.requestId;
          // Internal HTTP service supports opaque correlation. Do not send app identity to Gemini.
          if (kind === 'pronunciation' && requestId)
            headers.set('X-Request-ID', requestId);
          const response = await fetch(url, {
            ...init,
            headers,
            signal: controller.signal,
          });
          if (!response.ok) {
            const delay = retryDelay(response.headers?.get('retry-after'));
            const retryAfter =
              delay === undefined || delay > 60000
                ? undefined
                : Math.max(1, Math.ceil(delay / 1000));
            // No raw error body is read. Cancel streaming error payloads if supported.
            void response.body?.cancel().catch(() => {});
            if (response.status === 429)
              throw new ProviderFailure(
                'PROVIDER_RATE_LIMITED',
                true,
                retryAfter,
                delay,
              );
            if ([401, 403].includes(response.status))
              throw new ProviderFailure('PROVIDER_CONFIGURATION', false);
            throw new ProviderFailure(
              [500, 502, 503, 504].includes(response.status)
                ? 'PROVIDER_UNAVAILABLE'
                : 'PROVIDER_REJECTED',
              [500, 502, 503, 504].includes(response.status),
              retryAfter,
              delay,
              kind === 'writing' &&
                [500, 502, 503, 504].includes(response.status)
                ? 502
                : undefined,
            );
          }
          try {
            return await boundedJson(response);
          } catch (error) {
            if (controller.signal.aborted) throw error;
            throw new ProviderFailure('PROVIDER_INVALID_RESPONSE', false);
          }
        };
        try {
          return await Promise.race([work(), aborted]);
        } finally {
          clearTimeout(timer);
          if (cancel) signal?.removeEventListener('abort', cancel);
        }
      });
      telemetry.emit('provider.completed', {
        dependency: kind,
        attempt,
        durationMs: Math.round(performance.now() - started),
      });
      return result;
    } catch (error) {
      // Local 8C budget/concurrency failures must keep their 429 contract.
      if (error instanceof HttpException && !(error instanceof ProviderFailure))
        throw error;
      const failure =
        error instanceof ProviderFailure
          ? error
          : new ProviderFailure('PROVIDER_UNAVAILABLE', true);
      if (failure.code === 'PROVIDER_TIMEOUT')
        telemetry.count('provider.timeout');
      telemetry.emit(
        'provider.failed',
        {
          dependency: kind,
          attempt,
          code: failure.code,
          failureCategory: failure.code.toLowerCase(),
          durationMs: Math.round(performance.now() - started),
        },
        'warn',
      );
      const delay =
        failure.retryDelayMs ??
        (failure.retryAfter === undefined
          ? 200 + Math.floor(Math.random() * 101)
          : failure.retryAfter * 1000);
      if (
        attempt > retries ||
        !failure.retryable ||
        failure.code === 'PROVIDER_TIMEOUT' ||
        signal?.aborted ||
        delay > 1000 ||
        end - performance.now() <= delay
      )
        throw failure;
      telemetry.emit('provider.retry', {
        dependency: kind,
        attempt: attempt + 1,
        delayMs: delay,
      });
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          reject(new ProviderFailure('PROVIDER_UNAVAILABLE', true));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        }, delay);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    }
  }
}
