import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { CommunityImageStorage } from '../community/community-image.storage';
import {
  pendingChecks,
  ReadinessChecks,
  runReadinessProbes,
} from './readiness-probes';

@Injectable()
export class ReadinessService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ReadinessService.name);
  private checks = pendingChecks();
  private stopped = false;
  private generation = 0;
  private checkedAt = 0;
  private realRoot?: string;
  private controller?: AbortController;
  private flight?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private readonly timeout: number;
  private readonly interval: number;
  private readonly invalidate = () => {
    this.generation++;
    this.checkedAt = 0;
    this.checks = pendingChecks();
    this.controller?.abort();
  };
  private readonly reconnect = () => {
    this.invalidate();
    void this.refresh();
  };

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly images: CommunityImageStorage,
  ) {
    this.timeout = config.get<number>('READINESS_TIMEOUT_MS') ?? 5000;
    this.interval = config.get<number>('READINESS_RECHECK_MS') ?? 15000;
  }
  async onApplicationBootstrap() {
    for (const event of ['disconnected', 'disconnecting', 'close', 'error'])
      this.connection.on(event, this.invalidate);
    for (const event of ['connected', 'reconnected'])
      this.connection.on(event, this.reconnect);
    await this.refresh();
    if (!this.stopped) {
      this.timer = setInterval(() => {
        void this.refresh();
      }, this.interval);
      this.timer.unref();
    }
  }
  snapshot(): { status: 'ready' | 'not_ready'; checks: ReadinessChecks } {
    const checks = { ...this.checks };
    if (this.connection.readyState !== 1)
      checks.database = checks.transactions = checks.indexes = 'failed';
    if (
      this.stopped ||
      !this.checkedAt ||
      Date.now() - this.checkedAt > this.interval + this.timeout
    ) {
      for (const key of Object.keys(checks) as Array<keyof ReadinessChecks>)
        if (checks[key] === 'ok') checks[key] = 'pending';
    }
    return {
      status:
        !this.stopped && Object.values(checks).every((value) => value === 'ok')
          ? 'ready'
          : 'not_ready',
      checks,
    };
  }
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.flight) return this.flight;
    const generation = this.generation;
    const controller = (this.controller = new AbortController());
    let deadline: NodeJS.Timeout;
    const timedOut = new Promise<void>((resolve) => {
      deadline = setTimeout(() => {
        controller.abort();
        if (!this.stopped && generation === this.generation) {
          this.checks = {
            database: 'failed',
            transactions: 'failed',
            indexes: 'failed',
            uploads: 'failed',
          };
          this.checkedAt = Date.now();
          this.logger.warn('READINESS_CHECK_TIMEOUT');
        }
        resolve();
      }, this.timeout);
    });
    const work = runReadinessProbes(
      this.connection,
      this.images.root,
      this.config.get('NODE_ENV') !== 'production',
      controller.signal,
      this.timeout,
      this.realRoot,
    )
      .then((result) => {
        if (
          this.stopped ||
          controller.signal.aborted ||
          generation !== this.generation
        )
          return;
        this.checks = result.checks;
        this.checkedAt = Date.now();
        if (result.realRoot) this.realRoot = result.realRoot;
        if (result.diagnostics.length)
          this.logger.warn(JSON.stringify(result.diagnostics));
      })
      .catch(() => {
        if (!this.stopped && generation === this.generation) {
          this.checks = {
            database: 'failed',
            transactions: 'failed',
            indexes: 'failed',
            uploads: 'failed',
          };
          this.checkedAt = Date.now();
        }
      })
      .finally(() => {
        clearTimeout(deadline);
        this.flight = undefined;
      });
    // A hung filesystem syscall cannot be cancelled. Retain single-flight ownership
    // until it settles, but never let it hang startup, health responses or shutdown.
    const aborted = new Promise<void>((resolve) =>
      controller.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(deadline);
          resolve();
        },
        { once: true },
      ),
    );
    this.flight = Promise.race([work, timedOut, aborted]);
    return this.flight;
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.invalidate();
    clearInterval(this.timer);
    for (const event of ['disconnected', 'disconnecting', 'close', 'error'])
      this.connection.removeListener(event, this.invalidate);
    for (const event of ['connected', 'reconnected'])
      this.connection.removeListener(event, this.reconnect);
  }
  onModuleDestroy() {
    this.stop();
  }
}
