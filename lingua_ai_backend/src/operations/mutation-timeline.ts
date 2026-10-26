import { HttpException, Injectable, Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getConnectionToken, InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession, mongo } from 'mongoose';
import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { TimelineWriteGate } from './timeline-gate';
import { TimelineControlError, TimelineControl } from './timeline-contract';
import {
  mutationProtocol,
  TimelineHeaders,
} from '../compatibility/protocol-validation';
import type { ProtocolPolicy } from '../compatibility/protocol-contract';
import { telemetry } from './telemetry';

export interface MutationAdmission {
  readonly dataTimelineId: string;
  readonly protocol: number;
  readonly legacyReceipts: boolean;
}
@Injectable()
export class TimelineRuntimeState {
  draining = () => true;
  infrastructureReady = () => false;
  bind(draining: () => boolean, infrastructureReady: () => boolean) {
    this.draining = draining;
    this.infrastructureReady = infrastructureReady;
  }
}
export class ServerTimelineError extends HttpException {
  constructor(
    code:
      | 'SERVER_TIMELINE_REQUIRED'
      | 'SERVER_TIMELINE_CHANGED'
      | 'RECEIPT_TIMELINE_UNVERIFIED'
      | 'BACKEND_NOT_READY',
  ) {
    super(
      {
        code,
        message:
          code === 'SERVER_TIMELINE_REQUIRED'
            ? 'A data timeline is required.'
            : code === 'BACKEND_NOT_READY'
              ? 'Backend is temporarily unavailable.'
              : 'Timeline reconciliation is required.',
      },
      code === 'SERVER_TIMELINE_REQUIRED'
        ? 428
        : code === 'BACKEND_NOT_READY'
          ? 503
          : 409,
    );
  }
}
@Injectable()
export class MutationTimeline {
  private readonly context = new AsyncLocalStorage<MutationAdmission>();
  private readonly fenced = new WeakSet<ClientSession>();
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    readonly gate: TimelineWriteGate,
  ) {}
  run<T>(admission: MutationAdmission, work: () => T): T {
    return this.context.run(admission, work);
  }
  async admit(headers: TimelineHeaders = {}): Promise<MutationAdmission> {
    const policy =
      this.config.get<ProtocolPolicy>('CLIENT_PROTOCOL_POLICY') ??
      'ALLOW_LEGACY';
    const protocol = mutationProtocol(
      headers,
      policy,
      this.config.get<string>('RELEASE_BUILD_ID'),
    );
    const declared = headers['x-data-timeline'];
    if (protocol >= 2 && declared === undefined) {
      telemetry.emit('timeline_request_missing');
      throw new ServerTimelineError('SERVER_TIMELINE_REQUIRED');
    }
    let row: TimelineControl;
    try {
      row = await this.gate.assertWritesPermitted();
    } catch {
      telemetry.emit('timeline_write_blocked');
      throw new ServerTimelineError('BACKEND_NOT_READY');
    }
    if (declared !== undefined && declared !== row.dataTimelineId) {
      telemetry.emit('timeline_request_mismatch');
      throw new ServerTimelineError('SERVER_TIMELINE_CHANGED');
    }
    if (protocol === 1)
      telemetry.emit('legacy_timeline_write_admitted', {}, 'info', true);
    return Object.freeze({
      dataTimelineId: row.dataTimelineId,
      protocol,
      legacyReceipts: protocol === 1 && policy === 'ALLOW_LEGACY',
    });
  }
  async admission(): Promise<MutationAdmission> {
    return this.context.getStore() ?? this.admit();
  }
  async fresh(admission?: MutationAdmission): Promise<MutationAdmission> {
    const scope = admission ?? (await this.admission());
    let row: TimelineControl;
    try {
      row = await this.gate.assertWritesPermitted();
    } catch {
      throw new ServerTimelineError('BACKEND_NOT_READY');
    }
    if (scope.dataTimelineId !== row.dataTimelineId)
      throw new ServerTimelineError('SERVER_TIMELINE_CHANGED');
    return scope;
  }
  assertReceipt(
    receipt: { dataTimelineId?: string },
    scope: MutationAdmission,
  ) {
    if (receipt.dataTimelineId === undefined && scope.legacyReceipts) return;
    if (receipt.dataTimelineId === undefined) {
      telemetry.emit('receipt_timeline_conflict');
      throw new ServerTimelineError('RECEIPT_TIMELINE_UNVERIFIED');
    }
    if (receipt.dataTimelineId !== scope.dataTimelineId) {
      telemetry.emit('receipt_timeline_conflict');
      throw new ServerTimelineError('SERVER_TIMELINE_CHANGED');
    }
  }
  assertTransaction(session: ClientSession) {
    if (!this.fenced.has(session) || !session.inTransaction())
      throw new ServerTimelineError('BACKEND_NOT_READY');
  }
  async transaction<T>(
    domain: string,
    work: (session: ClientSession, scope: MutationAdmission) => Promise<T>,
    admitted?: MutationAdmission,
  ): Promise<T> {
    const scope = admitted ?? (await this.admission());
    const timeout = this.config.get<number>('READINESS_TIMEOUT_MS') ?? 5000;
    // No in-flight request is reinterpreted against a newer timeline on retry.
    for (let attempt = 0; attempt < 12; attempt++) {
      await this.fresh(scope);
      const session = await this.connection.startSession({
        defaultTimeoutMS: timeout,
      });
      try {
        session.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          readPreference: 'primary',
          maxCommitTimeMS: timeout,
        });
        await this.gate.assertAndTouchWriteFence(session, scope.dataTimelineId);
        this.fenced.add(session);
        const result = await this.run(scope, () => work(session, scope));
        await this.fresh(scope);
        for (let commitAttempt = 0; ; commitAttempt++) {
          try {
            await session.commitTransaction({ timeoutMS: timeout });
            break;
          } catch (error) {
            if (
              !(error instanceof mongo.MongoError) ||
              !error.hasErrorLabel('UnknownTransactionCommitResult') ||
              commitAttempt >= 2
            )
              throw error;
          }
        }
        return result;
      } catch (error) {
        if (session.inTransaction())
          await session
            .abortTransaction({ timeoutMS: timeout })
            .catch(() => undefined);
        const fenceFailure = error instanceof TimelineControlError;
        const transient =
          error instanceof mongo.MongoError &&
          error.hasErrorLabel('TransientTransactionError');
        if (!fenceFailure && !transient) throw error;
        await this.fresh(scope);
        if (attempt === 11) throw new ServerTimelineError('BACKEND_NOT_READY');
        telemetry.emit('timeline_fence_conflict', {
          domain,
          attempt: attempt + 1,
        });
        telemetry.emit('transaction.retry', {
          domain,
          attempt: attempt + 1,
          failureCategory: 'bounded_transaction_retry',
        });
        await delay(Math.min(5 * (attempt + 1), 40));
      } finally {
        this.fenced.delete(session);
        await session.endSession();
      }
    }
    throw new ServerTimelineError('BACKEND_NOT_READY');
  }
}
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    TimelineRuntimeState,
    {
      provide: TimelineWriteGate,
      useFactory: (
        connection: Connection,
        config: ConfigService,
        state: TimelineRuntimeState,
      ) =>
        new TimelineWriteGate(
          connection,
          config,
          () => state.draining(),
          () => state.infrastructureReady(),
        ),
      inject: [getConnectionToken(), ConfigService, TimelineRuntimeState],
    },
    MutationTimeline,
  ],
  exports: [TimelineWriteGate, TimelineRuntimeState, MutationTimeline],
})
export class MutationTimelineModule {}
