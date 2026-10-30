import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LessonsModule } from './lessons/lessons.module';
import { ProgressModule } from './progress/progress.module';
import { AiCoachModule } from './ai-coach/ai-coach.module';
import { FlashcardsModule } from './flashcards/flashcards.module';
import { PronunciationModule } from './pronunciation/pronunciation.module';
import { CommunityModule } from './community/community.module';
import { validateEnvironment } from './config/runtime-config';
import { OperationsModule } from './operations/operations.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        ...(configService.get('NODE_ENV') === 'production' ||
        configService.get('TIMELINE_AUTHORITY_MODE') === 'DURABLE_REQUIRED' ||
        configService.get('DEPLOYMENT_PROFILE') === 'DURABLE_REQUIRED'
          ? {
              autoIndex: false,
              autoCreate: false,
              bufferCommands: false,
              serverSelectionTimeoutMS: configService.get<number>(
                'READINESS_TIMEOUT_MS',
              ),
              connectTimeoutMS: configService.get<number>(
                'READINESS_TIMEOUT_MS',
              ),
              waitQueueTimeoutMS: configService.get<number>(
                'READINESS_TIMEOUT_MS',
              ),
              retryAttempts: 1,
              connectionErrorFactory: () =>
                new Error('Database connection unavailable'),
            }
          : {}),
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    LessonsModule,
    ProgressModule,
    AiCoachModule,
    FlashcardsModule,
    PronunciationModule,
    CommunityModule,
    OperationsModule,
    SecurityModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
