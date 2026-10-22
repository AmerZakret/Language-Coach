import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureCommunityUploadServing } from './community/community-upload-serving';
import { safeConfigSummary } from './config/runtime-config';
import { TrafficLifecycle } from './operations/traffic-lifecycle.service';
import { HttpSecurity } from './security/http-security';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  const security = app.get(HttpSecurity);
  security.install(app);
  app.get(TrafficLifecycle).attach(app, () => process.exit(1));
  security.installBodyParsers(app);

  configureCommunityUploadServing(app);

  const port = configService.getOrThrow<number>('PORT');
  Logger.log(JSON.stringify(safeConfigSummary(configService)), 'Configuration');
  await app.listen(port, '0.0.0.0');
  Logger.log(`Application listening on port ${port}`, 'Bootstrap');
}
bootstrap().catch(() => {
  console.error(
    'Backend startup failed. Check configuration and dependency availability.',
  );
  process.exit(1);
});
