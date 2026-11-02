import { TimelineWriteGate } from '../operations/timeline-gate';
import { Controller, Get, Res, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { protocolMetadata } from './protocol-contract';
import type { ProtocolPolicy } from './protocol-contract';

@Controller('compatibility')
export class CompatibilityController {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly gate?: TimelineWriteGate,
  ) {}
  @Get()
  async discover(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    const metadata = protocolMetadata(
      this.config.get<ProtocolPolicy>('CLIENT_PROTOCOL_POLICY') ??
        'ALLOW_LEGACY',
      this.config.get<string>('RELEASE_BUILD_ID') ?? 'development',
    );
    return {
      ...metadata,
      ...(await (this.gate?.discovery() ??
        Promise.resolve({
          dataTimelineId: null,
          timelineWriteState: 'UNAVAILABLE',
        }))),
    };
  }
}
