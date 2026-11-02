import type { ClientSession } from 'mongoose';
import { HttpException } from '@nestjs/common';
import { telemetry } from './telemetry';

// Observe the driver's existing callback retries; add no retry loop or schema writes.
export async function observedTransaction<T>(
  session: ClientSession,
  domain: string,
  work: (session: ClientSession) => Promise<T>,
  options?: Parameters<ClientSession['withTransaction']>[1],
): Promise<T> {
  let attempt = 0;
  try {
    return await session.withTransaction(async (current) => {
      if (++attempt > 1)
        telemetry.emit(
          'transaction.retry',
          { domain, attempt, failureCategory: 'driver_callback_retry' },
          'warn',
        );
      return work(current);
    }, options);
  } catch (error) {
    if (!(error instanceof HttpException))
      telemetry.error(
        'transaction.failed',
        {
          domain,
          failureCategory:
            error?.code === 11000 ? 'unique_conflict' : 'database_failure',
        },
        error,
      );
    throw error;
  }
}
