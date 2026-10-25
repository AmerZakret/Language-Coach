import { ClientProtocolGuard } from '../compatibility/client-protocol.guard';
import { CompatibilityController } from '../compatibility/compatibility.controller';
import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AbuseControls } from './abuse-controls';
import { ProviderBudget } from './provider-budget';
import { HttpSecurity } from './http-security';
import {
  RequestPolicyGuard,
  OwnerPolicyInterceptor,
} from './security-pipeline';
import { SafeExceptionFilter } from './safe-exception.filter';

@Global()
@Module({
  controllers: [CompatibilityController],
  providers: [
    { provide: APP_GUARD, useClass: ClientProtocolGuard },
    AbuseControls,
    ProviderBudget,
    HttpSecurity,
    { provide: APP_GUARD, useClass: RequestPolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: OwnerPolicyInterceptor },
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
  exports: [AbuseControls, ProviderBudget, HttpSecurity],
})
export class SecurityModule {}
