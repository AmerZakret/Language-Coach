import { HttpException } from '@nestjs/common';
import { protocolMetadata } from './protocol-contract';
import type { ProtocolPolicy } from './protocol-contract';

export class ClientProtocolError extends HttpException {
  readonly publicBody;
  constructor(
    code: 'CLIENT_PROTOCOL_REQUIRED' | 'CLIENT_PROTOCOL_UNSUPPORTED',
    policy: ProtocolPolicy,
    buildId = 'development',
  ) {
    const body = {
      statusCode: 426,
      code,
      message: 'Client update or pending-work reconciliation is required.',
      updateRequired: true,
      ...protocolMetadata(policy, buildId),
    };
    super(body, 426);
    this.publicBody = body;
  }
}
