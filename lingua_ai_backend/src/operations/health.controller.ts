import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReadinessService } from './readiness.service';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') ready(@Res({ passthrough: true }) response: Response) {
    const result = this.readiness.snapshot();
    response.status(result.status === 'ready' ? 200 : 503);
    response.setHeader('Cache-Control', 'no-store');
    return result;
  }
}
