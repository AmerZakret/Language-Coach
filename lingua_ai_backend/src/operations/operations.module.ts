import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { TrafficLifecycle } from './traffic-lifecycle.service';
import { TimelineWriteGate } from './timeline-gate';

@Module({
  imports: [CommunityModule],
  controllers: [HealthController],
  providers: [
    ReadinessService,
    TrafficLifecycle,
    {
      provide: TimelineWriteGate,
      useFactory: (readiness: ReadinessService) => readiness.timelineGate,
      inject: [ReadinessService],
    },
  ],
  exports: [ReadinessService, TrafficLifecycle, TimelineWriteGate],
})
export class OperationsModule {}
