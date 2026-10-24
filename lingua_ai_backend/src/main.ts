import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureCommunityUploadServing } from './community/community-upload-serving';
import { safeConfigSummary } from './config/runtime-config';
import { TrafficLifecycle } from './operations/traffic-lifecycle.service';
import { HttpSecurity } from './security/http-security';
import { StructuredNestLogger, telemetry } from './operations/telemetry';
import { ReadinessService } from './operations/readiness.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: new StructuredNestLogger(),
  });
  const configService = app.get(ConfigService);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  const security = app.get(HttpSecurity);
  security.install(app);
  app.get(TrafficLifecycle).attach(app, () => process.exit(1));
  security.installBodyParsers(app);

  configureCommunityUploadServing(app);

  const port = configService.getOrThrow<number>('PORT');
  telemetry.emit('application.configured', {
    ...safeConfigSummary(configService),
    rateLimitMode: 'per_process',
    readiness: app.get(ReadinessService).snapshot().status,
  });
  await app.listen(port, '0.0.0.0');
  telemetry.emit('application.started', {
    port,
    readiness: app.get(ReadinessService).snapshot().status,
  });
}
bootstrap().catch(() => {
  telemetry.error('application.startup_failed', {
    failureCategory: 'configuration_or_dependency',
  });
  process.exit(1);
});
