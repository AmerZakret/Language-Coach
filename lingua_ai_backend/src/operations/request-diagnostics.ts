import type { Request, Response, NextFunction } from 'express';
import { performance } from 'node:perf_hooks';
import { telemetry, sizeBucket, RequestContext } from './telemetry';

export function normalizedRoute(request: Request): string {
  if (typeof request.route?.path === 'string')
    return request.route.path.slice(0, 160);
  if (request.path.startsWith('/uploads/')) return '/uploads/:image';
  return 'unmatched'; // Never reflect raw URLs, params or query strings in logs.
}
export function requestDiagnostics(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = telemetry.requestId(req.headers['x-request-id']);
  const controller = new AbortController();
  const started = performance.now();
  const length = String(req.headers['content-length'] || '');
  const key = req.headers['x-idempotency-key'];
  const context: RequestContext = {
    requestId,
    method: /^[A-Z]{1,16}$/.test(req.method) ? req.method : 'OTHER',
    route: req.path.startsWith('/uploads/') ? '/uploads/:image' : 'unmatched',
    ownerType: 'anonymous',
    operationFingerprint:
      typeof key === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(key)
        ? telemetry.fingerprint('operation', key)
        : undefined,
    inputType: req.is('application/json')
      ? 'json'
      : req.is('multipart/form-data')
        ? 'multipart'
        : 'other',
    inputBucket: /^\d{1,9}$/.test(length)
      ? sizeBucket(Number(length))
      : 'unknown',
    signal: controller.signal,
  };
  res.setHeader('X-Request-ID', requestId);
  let completed = false;
  const abort = () => controller.abort();
  const complete = () => {
    if (completed) return;
    completed = true;
    if (!res.writableFinished) controller.abort();
    req.removeListener('aborted', abort);
    const route = normalizedRoute(req);
    if (route !== 'unmatched') context.route = route;
    telemetry.context.run(context, () => {
      telemetry.count(
        res.statusCode >= 500
          ? 'http.server_error'
          : res.statusCode === 429
            ? 'http.rate_limited'
            : 'http.other',
      );
      const health = ['/health', '/health/live', '/health/ready'].includes(
        context.route.toLowerCase().replace(/\/+$/, ''),
      );
      telemetry.emit(
        'http.completed',
        {
          statusCode: res.writableFinished ? res.statusCode : 499,
          durationMs: Math.round(performance.now() - started),
          rateLimited: res.statusCode === 429,
        },
        'info',
        health,
      );
    });
  };
  req.once('aborted', abort);
  res.once('finish', complete);
  res.once('close', complete);
  telemetry.context.run(context, next);
}
