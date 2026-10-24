import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { protocolMetadata } from './protocol-contract';
import type { ProtocolPolicy } from './protocol-contract';

@Controller('compatibility')
export class CompatibilityController {
  constructor(private readonly config: ConfigService) {}
  @Get()
  discover(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return protocolMetadata(
      this.config.get<ProtocolPolicy>('CLIENT_PROTOCOL_POLICY') ??
        'ALLOW_LEGACY',
      this.config.get<string>('RELEASE_BUILD_ID') ?? 'development',
    );
  }
}
