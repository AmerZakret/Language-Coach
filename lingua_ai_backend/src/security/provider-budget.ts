import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AbuseControls } from './abuse-controls';
import { rule, day } from './abuse-policy';

export type ProviderIdentity = { owner: string; ip: string; guest: boolean };
export type ProviderKind =
  | 'chat'
  | 'writing'
  | 'flashcard'
  | 'feedback'
  | 'pronunciation';

@Injectable()
export class ProviderBudget {
  readonly context = new AsyncLocalStorage<ProviderIdentity>();
  constructor(private readonly controls: AbuseControls) {}
  async run<T>(kind: ProviderKind, work: () => Promise<T>): Promise<T> {
    const identity = this.context.getStore();
    if (!identity)
      throw new ServiceUnavailableException({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Provider operation is unavailable.',
      });
    const { owner, ip, guest } = identity;
    const group = kind === 'pronunciation' ? 'pronunciation' : 'ai';
    const release = this.controls.acquire([
      {
        name: `${group}-owner-concurrency`,
        identity: owner,
        max: group === 'ai' ? 2 : 1,
      },
      {
        name: `${group}-ip-concurrency`,
        identity: ip,
        max: group === 'ai' && !guest ? 4 : 2,
      },
      {
        name: `${group}-process-concurrency`,
        identity: 'process',
        max: group === 'ai' ? 8 : 2,
      },
    ]);
    try {
      const limits = [
        rule('provider-owner', owner, guest ? 5 : 20),
        rule('provider-owner-day', owner, guest ? 30 : 300, day),
        rule('provider-ip', ip, 30),
        rule('provider-process', 'process', 120),
        rule(
          `${kind}-owner`,
          owner,
          {
            chat: 20,
            writing: 5,
            flashcard: 10,
            feedback: 10,
            pronunciation: 6,
          }[kind],
        ),
      ];
      if (guest) limits.push(rule('provider-guest-ip', ip, 10));
      if (kind === 'pronunciation')
        limits.push(
          rule('pronunciation-ip', ip, 15),
          rule('pronunciation-process', 'process', 30),
        );
      this.controls.consume(limits);
      return await work();
    } finally {
      release();
    }
  }
}

// Isolated legacy unit modules need no HTTP context. A production deployment
// missing the global control service must fail closed instead of bypassing it.
export function withProviderBudget<T>(
  budget: ProviderBudget | undefined,
  kind: ProviderKind,
  work: () => Promise<T>,
): Promise<T> {
  if (budget) return budget.run(kind, work);
  if (process.env.NODE_ENV === 'production')
    throw new ServiceUnavailableException({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Provider operation is unavailable.',
    });
  return work();
}
