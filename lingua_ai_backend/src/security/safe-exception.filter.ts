import { ClientProtocolError } from '../compatibility/client-protocol.error';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitError } from './abuse-controls';
import { telemetry } from '../operations/telemetry';
import { ProviderFailure } from '../operations/provider-client';
import { normalizedRoute } from '../operations/request-diagnostics';

// Only fixed messages/statuses are reflected, even if an exception carries a
// familiar code alongside an unsafe provider body or internal error object.
const known: Record<string, [number, string]> = {
  SERVER_TIMELINE_REQUIRED: [428, 'A data timeline is required.'],
  SERVER_TIMELINE_CHANGED: [409, 'Timeline reconciliation is required.'],
  RECEIPT_TIMELINE_UNVERIFIED: [
    409,
    'Receipt timeline provenance is unavailable.',
  ],
  INVALID_DATA_TIMELINE: [400, 'A canonical data timeline is required.'],
  IDEMPOTENCY_CONFLICT: [409, 'Operation key payload changed.'],
  STALE_RESOURCE_REVISION: [409, 'Resource changed. Refresh before retrying.'],
  INVALID_RESOURCE_REVISION: [400, 'A valid resource revision is required.'],
  INVALID_OPERATION_ID: [400, 'A valid operation key is required.'],
  MISSING_PROGRESS_EPOCH: [400, 'Progress epoch is required.'],
  INVALID_PROGRESS_EPOCH: [400, 'A valid progress epoch is required.'],
  STALE_PROGRESS_EPOCH: [409, 'Progress was reset; this work is obsolete.'],
  FUTURE_PROGRESS_EPOCH: [409, 'Progress epoch is ahead of the server.'],
  STALE_RESET_EPOCH: [409, 'Progress was reset; this reset is obsolete.'],
  FUTURE_RESET_EPOCH: [409, 'Reset epoch is ahead of the server.'],
  RESET_IDEMPOTENCY_CONFLICT: [409, 'Reset operation payload changed.'],
  RESET_NOT_COMMITTED: [404, 'No committed reset receipt found.'],
  PROVIDER_UNAVAILABLE: [503, 'Provider is temporarily unavailable.'],
  PROVIDER_TIMEOUT: [503, 'Provider deadline exceeded. Please retry.'],
  PROVIDER_RATE_LIMITED: [503, 'Provider is temporarily rate limited.'],
  PROVIDER_CONFIGURATION: [
    503,
    'Provider configuration requires operator attention.',
  ],
  PROVIDER_INVALID_RESPONSE: [502, 'Provider returned an invalid response.'],
  PROVIDER_REJECTED: [502, 'Provider could not accept this operation.'],
  RETRYABLE_SERVER_FAILURE: [
    503,
    'Operation could not be acknowledged. Retry the same operation.',
  ],
  FEATURE_DISABLED: [503, 'This feature is disabled.'],
  ABUSE_CONTROL_UNAVAILABLE: [
    503,
    'Service is temporarily busy. Please retry.',
  ],
  BACKEND_NOT_READY: [503, 'Backend is temporarily unavailable.'],
  SHUTTING_DOWN: [503, 'Backend is shutting down. Please retry.'],
  REQUEST_ABORTED: [503, 'Request could not be completed.'],
  VALIDATION_FAILED: [400, 'Input validation failed.'],
};
const standard: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Invalid request.'],
  401: ['UNAUTHORIZED', 'Authentication required or invalid.'],
  403: ['FORBIDDEN', 'Access denied.'],
  404: ['NOT_FOUND', 'Resource not found.'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed.'],
  408: ['REQUEST_TIMEOUT', 'Request timed out.'],
  409: ['CONFLICT', 'Request conflicts with resource state.'],
  413: ['PAYLOAD_TOO_LARGE', 'Request payload is too large.'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported request content type.'],
  429: ['RATE_LIMITED', 'Too many requests. Please retry later.'],
  500: ['INTERNAL_SERVER_ERROR', 'An unexpected server error occurred.'],
  502: ['PROVIDER_UNAVAILABLE', 'Provider is temporarily unavailable.'],
  503: [
    'RETRYABLE_SERVER_FAILURE',
    'Service is temporarily unavailable. Please retry.',
  ],
};
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent || response.destroyed) return;
    if (error instanceof ClientProtocolError) {
      response.setHeader('Cache-Control', 'no-store');
      response.status(426).json(error.publicBody);
      return;
    }
    let status = error instanceof HttpException ? error.getStatus() : 500;
    if (
      error?.type === 'entity.too.large' ||
      error?.type === 'parameters.too.many'
    )
      status = 413;
    if (error?.type === 'entity.parse.failed') status = 400;
    if (
      error?.type === 'encoding.unsupported' ||
      error?.type === 'charset.unsupported'
    )
      status = 415;
    if (error?.code === 11000) status = 409;
    const body =
      error instanceof HttpException ? error.getResponse() : undefined;
    const code =
      body &&
      typeof body === 'object' &&
      'code' in body &&
      typeof body.code === 'string'
        ? body.code
        : '';
    const safe = Object.hasOwn(known, code) ? known[code] : undefined;
    const request = host.switchToHttp().getRequest();
    const diagnostic = telemetry.context.getStore();
    if (diagnostic) diagnostic.route = normalizedRoute(request);
    if (status === 413 || code === 'VALIDATION_FAILED')
      telemetry.emit(
        'input.rejected',
        {
          inputType: diagnostic?.inputType,
          inputBucket: diagnostic?.inputBucket,
          failureCategory: status === 413 ? 'oversized' : 'validation',
        },
        'warn',
      );
    else if (safe && code.includes('EPOCH'))
      telemetry.emit('progress.epoch_conflict', { code }, 'warn');
    else if (status >= 500 && !(error instanceof ProviderFailure))
      telemetry.error(
        'http.failed',
        {
          statusCode: status,
          failureCategory:
            error instanceof HttpException
              ? 'application_failure'
              : 'unexpected_failure',
        },
        error,
      );
    else if (status >= 400)
      telemetry.emit(
        'http.rejected',
        { statusCode: status, code: safe ? code : undefined },
        'warn',
      );
    if (error instanceof ProviderFailure && error.retryAfter)
      response.setHeader('Retry-After', String(error.retryAfter));
    if (safe && safe[0] === status) {
      response.status(status).setHeader('Cache-Control', 'no-store');
      response.json({
        statusCode: status,
        code,
        message: safe[1],
        ...(error instanceof ProviderFailure && code !== 'PROVIDER_UNAVAILABLE'
          ? { retryable: error.retryable }
          : {}),
      });
      return;
    }
    if (error instanceof RateLimitError)
      response.setHeader('Retry-After', String(error.retryAfter));
    if (!Object.hasOwn(standard, status))
      status = status >= 400 && status < 500 ? 400 : 500;
    const [publicCode, message] = standard[status];
    response.setHeader('Cache-Control', 'no-store');
    response
      .status(status)
      .json({ statusCode: status, code: publicCode, message });
  }
}
