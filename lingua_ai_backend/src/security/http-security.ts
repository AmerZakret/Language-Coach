import {
  Injectable,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  corsOptions,
  originAllowed,
  trustedProxyPolicy,
} from '../config/runtime-config';
import { AbuseControls, RateLimitError } from './abuse-controls';
import { isHealth, rule } from './abuse-policy';
import { resolvedIp } from './security-pipeline';

@Injectable()
export class HttpSecurity {
  constructor(
    private readonly config: ConfigService,
    private readonly controls: AbuseControls,
  ) {}
  install(app: NestExpressApplication) {
    const express = app.getHttpAdapter().getInstance();
    express.disable('x-powered-by');
    express.set(
      'trust proxy',
      trustedProxyPolicy(this.config.get('TRUST_PROXY')),
    );
    app.use((req: any, res: any, next: () => void) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=()',
      );
      res.vary('Origin');
      if (!req.path.startsWith('/uploads/'))
        res.setHeader('Cache-Control', 'no-store');
      if (
        req.headers.origin &&
        !originAllowed(this.config, req.headers.origin)
      ) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(403).json({
          statusCode: 403,
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'Browser origin is not allowed.',
        });
        return;
      }
      next();
    });
    // Allowed browser clients must also receive CORS headers on limiter errors.
    // Preflight is cheap and terminates here; business work remains bounded below.
    app.enableCors(corsOptions(this.config));
    app.use((req: any, res: any, next: () => void) => {
      if (!isHealth(req.path)) {
        try {
          this.controls.consume([rule('general-ip', resolvedIp(req), 240)]);
        } catch (error) {
          res.setHeader('Cache-Control', 'no-store');
          if (error instanceof RateLimitError)
            res.setHeader('Retry-After', String(error.retryAfter));
          res.status(error instanceof RateLimitError ? 429 : 503).json({
            statusCode: error instanceof RateLimitError ? 429 : 503,
            code:
              error instanceof RateLimitError
                ? 'RATE_LIMITED'
                : 'ABUSE_CONTROL_UNAVAILABLE',
            message:
              error instanceof RateLimitError
                ? 'Too many requests. Please retry later.'
                : 'Service is temporarily busy. Please retry.',
          });
          return;
        }
      }
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        validationError: { target: false, value: false },
        exceptionFactory: () =>
          new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Input validation failed.',
          }),
      }),
    );
  }
  installBodyParsers(app: NestExpressApplication) {
    // Called after lifecycle middleware, with NestFactory bodyParser:false.
    app.useBodyParser('json', { limit: '32kb', strict: true, inflate: false });
    app.useBodyParser('urlencoded', {
      limit: '16kb',
      extended: false,
      parameterLimit: 50,
      inflate: false,
    });
  }
}
