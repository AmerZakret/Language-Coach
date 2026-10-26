import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { TrafficLifecycle } from './traffic-lifecycle.service';
import { MutationTimelineModule } from './mutation-timeline';

@Module({
  imports: [CommunityModule, MutationTimelineModule],
  controllers: [HealthController],
  providers: [ReadinessService, TrafficLifecycle],
  exports: [ReadinessService, TrafficLifecycle, MutationTimelineModule],
})
export class OperationsModule {}
