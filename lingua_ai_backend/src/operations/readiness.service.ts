import {
  Injectable,
  Optional,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { CommunityImageStorage } from '../community/community-image.storage';
import { telemetry } from './telemetry';
import { TimelineWriteGate } from './timeline-gate';
import { TimelineRuntimeState } from './mutation-timeline';
import {
  pendingChecks,
  ReadinessChecks,
  runReadinessProbes,
} from './readiness-probes';

@Injectable()
export class ReadinessService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private diagnosticState = 'not_ready';
  private failureReason?: string;
  private transition(state: string, reason: string) {
    if (this.diagnosticState !== state) {
      telemetry.emit('readiness.transition', {
        from: this.diagnosticState,
        to: state,
        reason,
      });
      this.diagnosticState = state;
    }
    if (state === 'not_ready' && this.failureReason !== reason)
      telemetry.emit(
        'readiness.check_failed',
        { failureCategory: reason },
        'warn',
      );
    this.failureReason = state === 'not_ready' ? reason : undefined;
  }
  private lastDiagnostics = '';
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
  readonly timelineGate: TimelineWriteGate;
  private readonly invalidate = () => {
    this.generation++;
    this.checkedAt = 0;
    this.checks = pendingChecks();
    this.controller?.abort();
    if (!this.stopped) this.transition('not_ready', 'mongo_disconnected');
  };
  private readonly reconnect = () => {
    this.invalidate();
    void this.refresh();
  };

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly images: CommunityImageStorage,
    @Optional() sharedGate?: TimelineWriteGate,
    @Optional() state?: TimelineRuntimeState,
  ) {
    this.timeout = config.get<number>('READINESS_TIMEOUT_MS') ?? 5000;
    this.interval = config.get<number>('READINESS_RECHECK_MS') ?? 15000;
    this.timelineGate =
      sharedGate ??
      new TimelineWriteGate(
        connection,
        config,
        () => this.stopped,
        () => {
          const { checks } = this.snapshot();
          return (
            !this.stopped &&
            [
              checks.database,
              checks.transactions,
              checks.indexes,
              checks.uploads,
            ].every((value) => value === 'ok')
          );
        },
      );
    state?.bind(
      () => this.stopped,
      () => {
        const { checks } = this.snapshot();
        return (
          !this.stopped &&
          [
            checks.database,
            checks.transactions,
            checks.indexes,
            checks.uploads,
          ].every((value) => value === 'ok')
        );
      },
    );
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
    const expired =
      !this.checkedAt ||
      Date.now() - this.checkedAt > this.interval + this.timeout;
    if (this.connection.readyState !== 1)
      checks.database =
        checks.transactions =
        checks.indexes =
        checks.timeline =
          'failed';
    if (this.stopped || expired) {
      for (const key of Object.keys(checks) as Array<keyof ReadinessChecks>)
        if (checks[key] === 'ok') checks[key] = 'pending';
    }
    const result = {
      status:
        !this.stopped && Object.values(checks).every((value) => value === 'ok')
          ? ('ready' as const)
          : ('not_ready' as const),
      checks,
    };
    if (!this.stopped)
      this.transition(
        result.status,
        result.status === 'ready'
          ? 'checks_passed'
          : this.connection.readyState !== 1
            ? 'mongo_disconnected'
            : expired
              ? 'verification_expired'
              : checks.database !== 'ok'
                ? 'database_check_failed'
                : checks.transactions !== 'ok'
                  ? 'transaction_probe_failed'
                  : checks.indexes !== 'ok'
                    ? 'critical_index_unavailable'
                    : checks.uploads !== 'ok'
                      ? 'upload_storage_unavailable'
                      : checks.timeline !== 'ok'
                        ? 'timeline_control_unavailable'
                        : 'verification_expired',
      );
    return result;
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
            timeline: 'failed',
          };
          this.checkedAt = Date.now();
          this.transition('not_ready', 'readiness_timeout');
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
      this.timelineGate,
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
        this.snapshot();
        const codes = [...new Set(result.diagnostics.map((item) => item.code))]
          .sort()
          .join(',');
        if (codes && codes !== this.lastDiagnostics)
          telemetry.emit('readiness.diagnostic', { code: codes }, 'warn');
        if (
          result.checks.uploads === 'failed' &&
          codes !== this.lastDiagnostics
        )
          telemetry.emit(
            'upload.storage_unavailable',
            { failureCategory: 'upload_check_failed' },
            'warn',
          );
        this.lastDiagnostics = codes;
      })
      .catch(() => {
        if (!this.stopped && generation === this.generation) {
          this.checks = {
            database: 'failed',
            transactions: 'failed',
            indexes: 'failed',
            uploads: 'failed',
            timeline: 'failed',
          };
          this.checkedAt = Date.now();
          this.transition('not_ready', 'probe_failed');
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
    this.transition('shutting_down', 'shutdown');
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
