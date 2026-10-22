import {
  CanActivate,
  Injectable,
  ExecutionContext,
  CallHandler,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, finalize } from 'rxjs';
import { isIP } from 'node:net';
import { AbuseControls } from './abuse-controls';
import { ProviderBudget } from './provider-budget';
import {
  ABUSE_POLICY,
  RoutePolicy,
  rule,
  hour,
  isHealth,
} from './abuse-policy';

export function resolvedIp(request: any): string {
  return isIP(request.ip || '')
    ? request.ip
    : request.socket.remoteAddress || 'unknown';
}

@Injectable()
export class RequestPolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly controls: AbuseControls,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<RoutePolicy>(ABUSE_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const ip = resolvedIp(request);
    if (policy === 'login')
      this.controls.consume([
        rule('login-ip', ip, 10),
        rule('login-ip-hour', ip, 100, hour),
        rule('login-process', 'process', 300),
      ]);
    if (policy === 'register')
      this.controls.consume([
        rule('register-ip', ip, 5),
        rule('register-ip-hour', ip, 20, hour),
        rule('register-process', 'process', 100),
      ]);
    if (policy === 'guest')
      this.controls.consume([
        rule('guest-ip', ip, 3),
        rule('guest-ip-hour', ip, 20, hour),
        rule('guest-process', 'process', 100),
      ]);
    return true;
  }
}

@Injectable()
export class OwnerPolicyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly controls: AbuseControls,
    private readonly providers: ProviderBudget,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    if (isHealth(request.path)) return next.handle();
    const user = request.user;
    if (!user) return next.handle(); // Public routes have their pre-auth IP policy.
    const owner = user._id?.toString();
    if (typeof owner !== 'string' || !/^[a-f\d]{24}$/i.test(owner))
      throw new UnauthorizedException();
    const ip = resolvedIp(request);
    const policy = this.reflector.getAllAndOverride<RoutePolicy>(ABUSE_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const rules = [rule('general-owner', owner, 180)];
    if (policy === 'community-write') {
      rules.push(
        rule('community-owner', owner, 20),
        rule('community-ip', ip, 60),
      );
      if (request.is('multipart/form-data'))
        rules.push(rule('upload-owner', owner, 10), rule('upload-ip', ip, 30));
    }
    if (policy === 'reaction')
      rules.push(
        rule('reaction-owner', owner, 60),
        rule('reaction-ip', ip, 120),
      );
    if (policy === 'flashcard-write')
      rules.push(rule('flashcard-write-owner', owner, 30));
    this.controls.consume(rules);
    // Bound buffering before multipart interceptors allocate image/audio memory.
    const group =
      request.path.toLowerCase().replace(/\/+$/, '') === '/pronunciation/assess'
        ? 'audio-http'
        : policy === 'community-write' && request.is('multipart/form-data')
          ? 'image-http'
          : undefined;
    const release = group
      ? this.controls.acquire([
          { name: `${group}-owner`, identity: owner, max: 1 },
          { name: `${group}-ip`, identity: ip, max: 2 },
          {
            name: `${group}-process`,
            identity: 'process',
            max: group === 'audio-http' ? 2 : 4,
          },
        ])
      : () => {};
    return new Observable((subscriber) =>
      this.providers.context.run(
        { owner, ip, guest: user.isGuest === true },
        () => next.handle().subscribe(subscriber),
      ),
    ).pipe(finalize(release));
  }
}
