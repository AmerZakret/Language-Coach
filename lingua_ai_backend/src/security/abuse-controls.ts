import {
  HttpException,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import type { Rule } from './abuse-policy';

export class RateLimitError extends HttpException {
  constructor(readonly retryAfter: number) {
    super(
      {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please retry later.',
      },
      429,
    );
  }
}

@Injectable()
export class AbuseControls implements OnModuleDestroy {
  private readonly buckets = new Map<string, { count: number; end: number }>();
  private readonly permits = new Map<string, number>();
  private readonly salt = randomBytes(32);
  private lastSweep = 0;
  private readonly timer = setInterval(() => this.sweep(Date.now()), 60000);
  constructor() {
    this.timer.unref();
  }
  private key(name: string, identity: string) {
    return createHmac('sha256', this.salt)
      .update(`${name}\0${identity}`)
      .digest('hex');
  }
  private sweep(now: number) {
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets)
      if (bucket.end <= now) this.buckets.delete(key);
  }
  consume(rules: Rule[]) {
    const now = Date.now();
    const entries = rules.map((item) => ({
      ...item,
      key: this.key(item.name, item.identity),
    }));
    // Check all budgets before changing any: denied work does not partially debit
    // unrelated buckets. Active buckets are never evicted to make room for abuse.
    for (const item of entries) {
      const bucket = this.buckets.get(item.key);
      if (bucket && bucket.end > now && bucket.count >= item.limit)
        throw new RateLimitError(
          Math.max(1, Math.ceil((bucket.end - now) / 1000)),
        );
    }
    if (
      this.buckets.size +
        entries.filter((item) => !this.buckets.has(item.key)).length >
      20000
    ) {
      if (now - this.lastSweep >= 1000) this.sweep(now);
      if (
        this.buckets.size +
          entries.filter((item) => !this.buckets.has(item.key)).length >
        20000
      )
        throw new ServiceUnavailableException({
          code: 'ABUSE_CONTROL_UNAVAILABLE',
          message: 'Service is temporarily busy. Please retry.',
        });
    }
    for (const item of entries) {
      const current = this.buckets.get(item.key);
      if (!current || current.end <= now)
        this.buckets.set(item.key, { count: 1, end: now + item.windowMs });
      else current.count++;
    }
  }
  acquire(
    limits: Array<{ name: string; identity: string; max: number }>,
  ): () => void {
    const entries = limits.map((item) => ({
      ...item,
      key: this.key(item.name, item.identity),
    }));
    if (entries.some((item) => (this.permits.get(item.key) || 0) >= item.max))
      throw new RateLimitError(1);
    for (const item of entries)
      this.permits.set(item.key, (this.permits.get(item.key) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const item of entries) {
        const count = (this.permits.get(item.key) || 1) - 1;
        if (count) this.permits.set(item.key, count);
        else this.permits.delete(item.key);
      }
    };
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
