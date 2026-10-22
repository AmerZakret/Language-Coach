import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { TrafficLifecycle } from './traffic-lifecycle.service';

@Module({
  imports: [CommunityModule],
  controllers: [HealthController],
  providers: [ReadinessService, TrafficLifecycle],
  exports: [ReadinessService, TrafficLifecycle],
})
export class OperationsModule {}
