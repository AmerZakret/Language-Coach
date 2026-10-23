import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { LoggerService } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

type Scalar = string | number | boolean | undefined;
type Fields = Record<string, Scalar>;
export type RequestContext = {
  requestId: string;
  method: string;
  route: string;
  ownerType: string;
  ownerFingerprint?: string;
  operationFingerprint?: string;
  inputType: string;
  inputBucket: string;
  signal: AbortSignal;
};
const secretNames = /SECRET|PASSWORD|TOKEN|API_KEY|MONGODB_URI/i;
const silentTestSink = process.env.NODE_ENV === 'test';
const fields = new Set(
  'requestId method route statusCode durationMs ownerType ownerFingerprint operationFingerprint dependency failureCategory code policy scope attempt timeoutMs delayMs outputTokenLimit inputBucket inputType from to reason environment port aiEnabled pronunciationEnabled corsOriginCount mongoConfigured uploadRootConfigured rateLimitMode readiness activeRequests rateLimited stack message domain'.split(
    ' ',
  ),
);

// One process-local sink, context and bounded counter vocabulary; no public metrics
// route and no user/IP labels. Direct helpers also cover isolated legacy modules.
export class OperationalTelemetry {
  readonly context = new AsyncLocalStorage<RequestContext>();
  private readonly salt = randomBytes(32);
  private readonly secrets = new Set<string>();
  private readonly counters = new Map<string, number>();
  constructor(
    private readonly sink: (line: string) => void = (line) => {
      if (!silentTestSink) process.stdout.write(line + '\n');
    },
  ) {
    for (const [name, value] of Object.entries(process.env))
      if (secretNames.test(name) && value) this.secrets.add(value);
  }
  configure(config: Pick<ConfigService, 'get'>) {
    for (const [name, value] of Object.entries(process.env))
      if (secretNames.test(name) && value) this.secrets.add(value);
    for (const name of ['JWT_SECRET', 'MONGODB_URI', 'GEMINI_API_KEY']) {
      const value = config.get<string>(name);
      if (value) this.secrets.add(value);
    }
  }
  redact(value: string): string {
    let result = value;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      result = result.split(secret).join('[REDACTED]');
    return result
      .replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[REDACTED_MONGO]')
      .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        '[REDACTED_JWT]',
      )
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_KEY]')
      .replace(
        /\b(password|authorization|cookie|set-cookie|api[_-]?key|token)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
        '$1=[REDACTED]',
      )
      .replace(/[\u0000-\u001f\u007f]/g, ' ');
  }
  fingerprint(kind: string, value: string): string {
    return createHmac('sha256', this.salt)
      .update(`${kind}\0${value}`)
      .digest('hex')
      .slice(0, 16);
  }
  requestId(value: unknown): string {
    return typeof value === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value) &&
      this.redact(value) === value
      ? value
      : randomUUID();
  }
  count(event: string) {
    if (!/^[a-z][a-z_.]{0,63}$/.test(event)) return;
    if (this.counters.has(event) || this.counters.size < 100)
      this.counters.set(
        event,
        Math.min(Number.MAX_SAFE_INTEGER, (this.counters.get(event) || 0) + 1),
      );
  }
  snapshotCounters() {
    return Object.fromEntries(this.counters);
  }
  emit(
    event: string,
    data: Fields = {},
    level: 'info' | 'warn' | 'error' = 'info',
    quiet = false,
  ) {
    this.count(event);
    if (quiet) return;
    const context = this.context.getStore();
    const record: Record<string, Scalar> = {
      timestamp: new Date().toISOString(),
      level,
      event: /^[a-z][a-z_.]{0,63}$/.test(event)
        ? event
        : 'diagnostic.invalid_event',
    };
    const merged = {
      requestId: context?.requestId,
      method: context?.method,
      route: context?.route,
      ownerType: context?.ownerType,
      ownerFingerprint: context?.ownerFingerprint,
      operationFingerprint: context?.operationFingerprint,
      ...data,
    };
    for (const [key, value] of Object.entries(merged))
      if (fields.has(key)) {
        if (typeof value === 'string')
          record[key] = this.redact(value).slice(
            0,
            key === 'stack' ? 800 : key === 'message' ? 512 : 160,
          );
        else if (
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        )
          record[key] = value;
      }
    // Redact before truncating values: truncation must never expose a secret prefix.
    try {
      this.sink(JSON.stringify(record));
    } catch {
      /* Logging must not change domain outcomes. */
    }
  }
  error(event: string, data: Fields = {}, error?: unknown) {
    // Strip the entire error message (including injected newlines/fake frames)
    // before extracting fixed-format function/basename/line fields. Never emit a
    // raw stack or filesystem path. Unrecognized stacks use the handling site.
    const prefix =
      error instanceof Error ? `${error.name}: ${error.message}` : '';
    const original =
      error instanceof Error && prefix && error.stack?.startsWith(prefix)
        ? error.stack.slice(prefix.length)
        : undefined;
    const source =
      original ?? new Error().stack?.split('\n').slice(1).join('\n');
    const stack = source
      ?.split('\n')
      .filter((line) => /^\s*at\s/.test(line))
      .slice(0, 6)
      .map((line) => {
        const method =
          /^\s*at\s+([\w.$<>]{1,80})\s/.exec(line)?.[1] ?? 'anonymous';
        const site = /([A-Za-z0-9_-]+\.(?:js|ts)):(\d{1,7}):(\d{1,7})/.exec(
          line,
        );
        return site ? `${method} (${site[1]}:${site[2]}:${site[3]})` : method;
      })
      .join(' > ');
    this.emit(event, { ...data, stack }, 'error');
  }
}
export const telemetry = new OperationalTelemetry();
export function sizeBucket(size: number): string {
  return size <= 1024
    ? 'le_1k'
    : size <= 4096
      ? 'le_4k'
      : size <= 16384
        ? 'le_16k'
        : size <= 32768
          ? 'le_32k'
          : 'over_32k';
}
export function receiptEvent(
  event:
    | 'receipt.created'
    | 'receipt.replay'
    | 'receipt.conflict'
    | 'reset.recovered',
  domain: string,
  owner: string,
  operation: string,
) {
  telemetry.emit(event, {
    domain,
    ownerFingerprint: telemetry.fingerprint('owner', owner),
    operationFingerprint: telemetry.fingerprint('operation', operation),
  });
}
export class StructuredNestLogger implements LoggerService {
  log(message: unknown, ..._context: unknown[]) {
    telemetry.emit('framework.info', {
      message:
        typeof message === 'string' ? message : 'Framework lifecycle event',
    });
  }
  warn(..._arguments: unknown[]) {
    telemetry.emit(
      'framework.warning',
      { failureCategory: 'framework_warning' },
      'warn',
    );
  }
  error(..._arguments: unknown[]) {
    telemetry.error('framework.error', { failureCategory: 'framework_error' });
  }
  debug(..._arguments: unknown[]) {}
  verbose(..._arguments: unknown[]) {}
  fatal(..._arguments: unknown[]) {
    telemetry.error('framework.fatal');
  }
}
