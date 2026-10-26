import {
  BadRequestException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ExecutionContext,
  CallHandler,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, from, mergeMap } from 'rxjs';
import { protocolRoute, ProtocolPolicy } from './protocol-contract';
import {
  mutationProtocol,
  validateDeclaredTimeline,
} from './protocol-validation';
import { MutationTimeline } from '../operations/mutation-timeline';

interface ProtocolRequest {
  method: string;
  path: string;
  route?: { path?: unknown };
  headers: Record<string, string | string[] | undefined>;
}
// Interceptors run after route authentication guards and before DTO/file pipes.
@Injectable()
export class ClientProtocolGuard implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly timeline?: MutationTimeline,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ProtocolRequest>();
    const path =
      typeof request.route?.path === 'string'
        ? request.route.path.replace(/\/+$/, '') || '/'
        : request.path;
    if (
      protocolRoute(request.method, path) !== 'PROTOCOL_REQUIRED_WHEN_ENFORCED'
    ) {
      validateDeclaredTimeline(request.headers);
      return next.handle();
    }
    const policy =
      this.config.get<ProtocolPolicy>('CLIENT_PROTOCOL_POLICY') ??
      'ALLOW_LEGACY';
    const protocol = mutationProtocol(
      request.headers,
      policy,
      this.config.get<string>('RELEASE_BUILD_ID'),
    );
    if (!this.timeline)
      throw new ServiceUnavailableException({
        code: 'BACKEND_NOT_READY',
        message: 'Backend is temporarily unavailable.',
      });
    return from(this.timeline.admit(request.headers)).pipe(
      mergeMap(
        (admission) =>
          new Observable((subscriber) =>
            this.timeline!.run(admission, () => {
              if (
                path.startsWith('/flashcards') &&
                protocol >= 1 &&
                request.headers['x-client-protocol'] !== undefined &&
                (typeof request.headers['x-idempotency-key'] !== 'string' ||
                  !/^[A-Za-z0-9._:-]{1,128}$/.test(
                    request.headers['x-idempotency-key'],
                  ))
              ) {
                subscriber.error(
                  new BadRequestException({
                    code: 'INVALID_OPERATION_ID',
                    message: 'A valid operation key is required.',
                  }),
                );
                return;
              }
              return next.handle().subscribe(subscriber);
            }),
          ),
      ),
    );
  }
}
