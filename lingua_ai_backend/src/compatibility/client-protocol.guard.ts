import { BadRequestException, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CURRENT_CLIENT_PROTOCOL,
  MINIMUM_MUTATION_PROTOCOL,
  protocolRoute,
} from './protocol-contract';
import type { ProtocolPolicy } from './protocol-contract';
import { ClientProtocolError } from './client-protocol.error';
import { telemetry } from '../operations/telemetry';

interface ProtocolRequest {
  method: string;
  path: string;
  route?: { path?: unknown };
  headers: Record<string, string | string[] | undefined>;
}
@Injectable()
export class ClientProtocolGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ProtocolRequest>();
    const path =
      typeof request.route?.path === 'string'
        ? request.route.path.replace(/\/+$/, '') || '/'
        : request.path;
    if (
      protocolRoute(request.method, path) !== 'PROTOCOL_REQUIRED_WHEN_ENFORCED'
    )
      return true;
    const policy =
      this.config.get<ProtocolPolicy>('CLIENT_PROTOCOL_POLICY') ??
      'ALLOW_LEGACY';
    const raw = request.headers['x-client-protocol'];
    if (raw === undefined && policy === 'ALLOW_LEGACY') {
      telemetry.emit('client_protocol.legacy', { code: 'HEADER_ABSENT' });
      return true;
    }
    if (raw === undefined)
      throw new ClientProtocolError(
        'CLIENT_PROTOCOL_REQUIRED',
        policy,
        this.config.get<string>('RELEASE_BUILD_ID') ?? 'development',
      );
    if (
      typeof raw !== 'string' ||
      !/^(0|[1-9]\d{0,5})$/.test(raw) ||
      Number(raw) < MINIMUM_MUTATION_PROTOCOL ||
      Number(raw) > CURRENT_CLIENT_PROTOCOL
    )
      throw new ClientProtocolError(
        'CLIENT_PROTOCOL_UNSUPPORTED',
        policy,
        this.config.get<string>('RELEASE_BUILD_ID') ?? 'development',
      );
    if (
      path.startsWith('/flashcards') &&
      (typeof request.headers['x-idempotency-key'] !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(request.headers['x-idempotency-key']))
    )
      throw new BadRequestException({
        code: 'INVALID_OPERATION_ID',
        message: 'A valid operation key is required.',
      });
    return true;
  }
}
