import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import { finalize } from 'rxjs';
import { ReadinessService } from './readiness.service';
import { telemetry } from './telemetry';

type ActiveRequest = {
  responseDone: boolean;
  handlerActive: boolean;
};
const activeRequest = Symbol('active-request');

@Injectable()
export class TrafficLifecycle implements NestInterceptor, OnModuleDestroy {
  private stopping = false;
  private readonly active = new Set<ActiveRequest>();
  private drainDone?: () => void;
  private drain?: Promise<void>;
  private server?: Server;
  private hardExit?: () => void;
  private hardDeadline?: NodeJS.Timeout;
  private readonly grace: number;

  constructor(
    private readonly readiness: ReadinessService,
    private readonly config: ConfigService,
  ) {
    this.grace = config.get<number>('SHUTDOWN_GRACE_MS') ?? 25000;
  }
  attach(app: INestApplication, hardExit?: () => void) {
    this.server = app.getHttpServer() as Server;
    this.hardExit = hardExit;
    app.use(this.middleware);
    app.useGlobalInterceptors(this);
    // Nest already coalesces repeated signals. Coalesce repeated programmatic
    // closes as well; MongoDB remains owned/closed by Nest's Mongoose lifecycle.
    const original = app.close.bind(app);
    let close: Promise<void> | undefined;
    app.close = (...args: Parameters<INestApplication['close']>) =>
      (close ??= original(...args).then(() => {
        clearTimeout(this.hardDeadline);
      }));
  }
  readonly middleware = (req: Request, res: Response, next: NextFunction) => {
    const health = [
      '/health',
      '/health/live',
      '/health/ready',
      '/compatibility',
    ].includes(req.path.replace(/\/+$/, ''));
    if (
      !health &&
      (this.stopping ||
        (this.config.get('NODE_ENV') === 'production' &&
          this.readiness.snapshot().status !== 'ready'))
    ) {
      res.setHeader('Connection', 'close');
      res.status(503).json({
        code: this.stopping ? 'SHUTTING_DOWN' : 'BACKEND_NOT_READY',
        message: 'Backend is temporarily unavailable.',
      });
      return;
    }
    if (!health) {
      const record: ActiveRequest = {
        responseDone: false,
        handlerActive: false,
      };
      req[activeRequest] = record;
      this.active.add(record);
      res.once('finish', () => {
        record.responseDone = true;
        this.release(record);
      });
      res.once('close', () => {
        record.responseDone = true;
        this.release(record);
      });
    }
    const admit = () => {
      if (res.destroyed || res.writableEnded) return;
      // A control query may finish after shutdown started.
      if (!health && this.stopping) {
        res.status(503).json({
          code: 'SHUTTING_DOWN',
          message: 'Backend is temporarily unavailable.',
        });
        return;
      }
      next();
    };
    if (!health && this.config.get('NODE_ENV') === 'production') {
      // Fresh primary check on every production admission, including GETs with
      // hidden side effects. This is not the domain transaction fence (10B).
      void this.readiness.timelineGate
        .assertWritesPermitted()
        .then(admit)
        .catch(() => {
          if (res.destroyed || res.writableEnded) return;
          res.status(503).json({
            code: 'BACKEND_NOT_READY',
            message: 'Backend is temporarily unavailable.',
          });
        });
      return;
    }
    admit();
  };
  intercept(context: ExecutionContext, next: CallHandler) {
    const record = context.switchToHttp().getRequest()[activeRequest] as
      | ActiveRequest
      | undefined;
    // Guards/body parsing may finish after disconnect/drain has begun. Do not
    // start a controller mutation then; an already executing controller drains.
    if (record && (record.responseDone || this.stopping)) {
      throw new ServiceUnavailableException({
        code: this.stopping ? 'SHUTTING_DOWN' : 'REQUEST_ABORTED',
        message: 'Request could not be completed.',
      });
    }
    if (record) record.handlerActive = true;
    return next.handle().pipe(
      finalize(() => {
        if (record) {
          record.handlerActive = false;
          this.release(record);
        }
      }),
    );
  }
  private release(record: ActiveRequest) {
    if (!record.responseDone || record.handlerActive) return;
    this.active.delete(record);
    if (!this.active.size) this.drainDone?.();
  }
  beginShutdown(): Promise<void> {
    if (this.drain) return this.drain;
    telemetry.emit('shutdown.requested');
    this.stopping = true;
    this.readiness.stop();
    telemetry.emit('shutdown.drain_started', {
      activeRequests: this.active.size,
    });
    // Keep health visible while rejecting new work, then let Nest close HTTP.
    this.server?.closeIdleConnections();
    if (this.hardExit) {
      this.hardDeadline = setTimeout(() => {
        telemetry.error('shutdown.watchdog', {
          activeRequests: this.active.size,
        });
        this.hardExit?.();
      }, this.grace);
      this.hardDeadline.unref();
    }
    this.drain = new Promise<void>((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        telemetry.emit('shutdown.drain_completed', {
          activeRequests: this.active.size,
        });
        resolve();
      };
      // Reserve part of the total window for Nest HTTP/Mongoose disposal.
      const deadline = setTimeout(
        () => {
          telemetry.emit(
            'shutdown.drain_timeout',
            { activeRequests: this.active.size },
            'warn',
          );
          this.server?.closeAllConnections();
          done();
        },
        Math.floor(this.grace * 0.8),
      );
      this.drainDone = done;
      if (!this.active.size) done();
    });
    return this.drain;
  }
  onModuleDestroy() {
    return this.beginShutdown();
  }
}
