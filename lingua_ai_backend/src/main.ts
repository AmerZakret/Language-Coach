import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureCommunityUploadServing } from './community/community-upload-serving';
import { corsOptions, safeConfigSummary } from './config/runtime-config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors(corsOptions(configService));

  configureCommunityUploadServing(app);

  const port = configService.getOrThrow<number>('PORT');
  Logger.log(JSON.stringify(safeConfigSummary(configService)), 'Configuration');
  await app.listen(port, '0.0.0.0');
  Logger.log(`Application listening on port ${port}`, 'Bootstrap');
}
bootstrap().catch(() => {
  console.error('Backend startup failed. Check configuration and dependency availability.');
  process.exit(1);
});
