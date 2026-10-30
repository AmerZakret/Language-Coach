import { CLIENT_PROTOCOL_HEADER } from '../compatibility/protocol-contract';
import { mongo } from 'mongoose';
import { isAbsolute, resolve, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { isIP } from 'node:net';
import type { ConfigService } from '@nestjs/config';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { isTimelineId, WriteState } from '../operations/timeline-contract';
import { authorityIdentity } from '../operations/durable-authority';

export interface RuntimeConfig extends Record<string, unknown> {
  DATA_TIMELINE_ID: string;
  DATA_WRITE_MODE: WriteState;
  CLIENT_PROTOCOL_POLICY: 'ALLOW_LEGACY' | 'ENFORCE_MUTATIONS';
  RELEASE_BUILD_ID: string;
  NODE_ENV: 'development' | 'test' | 'production';
  MONGODB_URI: string;
  JWT_SECRET: string;
  PORT: number;
  AI_ENABLED: boolean;
  PRONUNCIATION_ENABLED: boolean;
  PRONUNCIATION_SERVICE_TOKEN: string;
  CORS_ORIGINS: string;
  UPLOAD_ROOT: string;
  READINESS_TIMEOUT_MS: number;
  READINESS_RECHECK_MS: number;
  SHUTDOWN_GRACE_MS: number;
  TRUST_PROXY: string;
  PROVIDER_CHAT_TIMEOUT_MS: number;
  PROVIDER_WRITING_TIMEOUT_MS: number;
  PROVIDER_FLASHCARD_TIMEOUT_MS: number;
  PROVIDER_FEEDBACK_TIMEOUT_MS: number;
  PROVIDER_PRONUNCIATION_TIMEOUT_MS: number;
  PROVIDER_MAX_RETRIES: number;
}

// Never interpolate supplied values or parser errors: URIs may contain secrets.
function invalid(name: string, policy: string): never {
  throw new Error(`Configuration error: ${name} ${policy}`);
}
function text(env: Record<string, unknown>, name: string): string {
  return typeof env[name] === 'string' ? env[name].trim() : '';
}
function flag(
  env: Record<string, unknown>,
  name: string,
  fallback?: boolean,
): boolean {
  const value = env[name];
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  if (value === undefined && fallback !== undefined) return fallback;
  return invalid(name, 'must be explicitly true or false');
}
export function isLocalHost(host: string): boolean {
  let value = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  // Canonicalize literal IP spellings without resolving DNS (e.g. expanded IPv6).
  try {
    value = new URL(
      `http://${value.includes(':') ? `[${value}]` : value}`,
    ).hostname.replace(/^\[|\]$/g, '');
  } catch {
    /* Mongo/HTTP parsers reject malformed hosts separately. */
  }
  return (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value === '::1' ||
    value === '::' ||
    value.startsWith('::ffff:') ||
    /^127\./.test(value) ||
    value === '0.0.0.0' ||
    value === 'host.docker.internal' ||
    value === '10.0.2.2'
  );
}
function httpUrl(value: string, name: string): URL {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return invalid(
        name,
        'must be an HTTP(S) URL without credentials, query or fragment',
      );
    return url;
  } catch {
    return invalid(name, 'must be a valid HTTP(S) URL');
  }
}
export function corsOptions(config: Pick<ConfigService, 'get'>): CorsOptions {
  return {
    credentials: false,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Idempotency-Key',
      'X-Resource-Revision',
      'X-Request-ID',
      CLIENT_PROTOCOL_HEADER,
      'X-Data-Timeline',
    ],
    exposedHeaders: ['Retry-After', 'X-Request-ID'],
    origin: (origin, done) => done(null, originAllowed(config, origin)),
  };
}
export function originAllowed(
  config: Pick<ConfigService, 'get'>,
  origin: string | undefined,
): boolean {
  const origins = (config.get<string>('CORS_ORIGINS') || '')
    .split(',')
    .filter(Boolean);
  const development = config.get('NODE_ENV') !== 'production';
  return (
    !origin ||
    origins.includes(origin) ||
    (development &&
      (() => {
        try {
          return isLocalHost(new URL(origin).hostname);
        } catch {
          return false;
        }
      })())
  );
}
export function trustedProxyPolicy(value: unknown): false | string[] {
  if (value === undefined || value === 'false' || value === false) return false;
  if (typeof value !== 'string' || !value.trim())
    return invalid(
      'TRUST_PROXY',
      'must be false or an explicit IP/CIDR allowlist',
    );
  return value.split(',').map((item) => {
    const parts = item.trim().split('/');
    const version = isIP(parts[0]);
    if (
      !version ||
      parts.length > 2 ||
      (parts.length === 2 &&
        (!/^\d+$/.test(parts[1]) ||
          Number(parts[1]) < 1 ||
          Number(parts[1]) > (version === 4 ? 32 : 128)))
    )
      return invalid(
        'TRUST_PROXY',
        'must be false or an explicit IP/CIDR allowlist; blanket trust is forbidden',
      );
    return item.trim();
  });
}
export function featureEnabled(
  config: Pick<ConfigService, 'get'>,
  key: 'AI_ENABLED' | 'PRONUNCIATION_ENABLED',
): boolean {
  const value = config.get(key);
  // Unvalidated test/development modules retain their existing behavior.
  return value !== false && value !== 'false';
}

/** Shape validation only. No network, filesystem writes, or topology probes. */
export function validateEnvironment(
  env: Record<string, unknown>,
): RuntimeConfig {
  const mode = text(env, 'NODE_ENV') || 'development';
  if (!['development', 'test', 'production'].includes(mode))
    invalid('NODE_ENV', 'must be development, test or production');
  const production = mode === 'production';
  const protocolPolicy =
    text(env, 'CLIENT_PROTOCOL_POLICY') || (production ? '' : 'ALLOW_LEGACY');
  if (!['ALLOW_LEGACY', 'ENFORCE_MUTATIONS'].includes(protocolPolicy))
    invalid(
      'CLIENT_PROTOCOL_POLICY',
      'must explicitly be ALLOW_LEGACY or ENFORCE_MUTATIONS',
    );
  // No generated/default identity, in any environment. Local setup is explicit.
  const timeline = env.DATA_TIMELINE_ID;
  if ((production || timeline !== undefined) && !isTimelineId(timeline))
    invalid(
      'DATA_TIMELINE_ID',
      'must be an explicit canonical lowercase UUID v4 (36 public characters)',
    );
  const writeMode = env.DATA_WRITE_MODE ?? (production ? '' : 'CLOSED');
  const authorityMode =
    env.TIMELINE_AUTHORITY_MODE === undefined
      ? 'LEGACY_LOCAL'
      : text(env, 'TIMELINE_AUTHORITY_MODE');
  const authorityProfile =
    env.DEPLOYMENT_PROFILE === undefined
      ? 'LEGACY_LOCAL'
      : text(env, 'DEPLOYMENT_PROFILE');
  if (
    !['LEGACY_LOCAL', 'DURABLE_REQUIRED'].includes(String(authorityMode)) ||
    !['LEGACY_LOCAL', 'DURABLE_REQUIRED'].includes(String(authorityProfile)) ||
    (authorityProfile === 'DURABLE_REQUIRED' &&
      authorityMode !== 'DURABLE_REQUIRED')
  )
    invalid(
      'TIMELINE_AUTHORITY_MODE',
      'must satisfy the explicit deployment profile',
    );
  if (authorityMode === 'DURABLE_REQUIRED') {
    if (
      !authorityIdentity(env.TIMELINE_AUTHORITY_ENVIRONMENT) ||
      !authorityIdentity(env.TIMELINE_AUTHORITY_STORAGE_ID, 96)
    )
      invalid(
        'TIMELINE_AUTHORITY_ENVIRONMENT',
        'requires explicit public environment/storage identities',
      );
    const rawGeneration = env.TIMELINE_AUTHORITY_GENERATION;
    const generation =
      typeof rawGeneration === 'number' || typeof rawGeneration === 'string'
        ? String(rawGeneration)
        : '';
    if (
      !/^[1-9][0-9]{0,15}$/.test(generation) ||
      !Number.isSafeInteger(Number(generation))
    )
      invalid(
        'TIMELINE_AUTHORITY_GENERATION',
        'requires an explicit positive safe integer',
      );
    try {
      const url = new URL(text(env, 'TIMELINE_AUTHORITY_URL'));
      if (
        url.protocol !== 'postgresql:' ||
        !url.username ||
        !url.password ||
        !url.hostname ||
        !url.pathname.slice(1) ||
        url.hash ||
        [...url.searchParams.keys()].some((k) => k !== 'sslmode') ||
        (url.hostname !== 'authority' &&
          url.searchParams.get('sslmode') !== 'verify-full')
      )
        throw new Error();
    } catch {
      invalid(
        'TIMELINE_AUTHORITY_URL',
        'requires explicit PostgreSQL credentials and verified TLS outside disposable authority DNS',
      );
    }
  }
  if (writeMode !== 'OPEN' && writeMode !== 'CLOSED')
    invalid('DATA_WRITE_MODE', 'must explicitly be OPEN or CLOSED');
  const buildId =
    env.RELEASE_BUILD_ID === undefined
      ? 'development'
      : text(env, 'RELEASE_BUILD_ID');
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(buildId))
    invalid(
      'RELEASE_BUILD_ID',
      'must be a public identifier of 1 to 96 safe characters',
    );
  const proxy = env.TRUST_PROXY === undefined ? 'false' : env.TRUST_PROXY;
  trustedProxyPolicy(proxy);
  const uri = text(env, 'MONGODB_URI');
  if (!uri) invalid('MONGODB_URI', 'is required');
  try {
    if (!/^mongodb(?:\+srv)?:\/\//.test(uri))
      invalid('MONGODB_URI', 'must use a MongoDB scheme');
    const client = new mongo.MongoClient(uri); // Parse only; never connect.
    const hosts = client.options.srvHost
      ? [client.options.srvHost]
      : client.options.hosts.map((host) => host.host);
    if (
      production &&
      hosts.some(isLocalHost) &&
      !flag(env, 'ALLOW_LOCAL_MONGODB', false)
    )
      invalid(
        'MONGODB_URI',
        'requires ALLOW_LOCAL_MONGODB=true for self-hosted loopback deployments',
      );
  } catch {
    invalid(
      'MONGODB_URI',
      'must be valid; local hosts require the explicit self-hosted override',
    );
  }
  const secret = text(env, 'JWT_SECRET');
  if (!secret) invalid('JWT_SECRET', 'is required');
  if (
    production &&
    (secret.length < 32 ||
      new Set(secret).size < 12 ||
      /secret|password|changeme|change.me|placeholder|your[_-]|development|example|fallback|default/i.test(
        secret,
      ) ||
      /^(?:[a-z]+|[A-Z]+|[0-9]+)$/.test(secret) ||
      /^(.+)\1+$/.test(secret))
  )
    invalid(
      'JWT_SECRET',
      'must be randomly generated (at least 32 characters, 12 distinct characters; no defaults/placeholders)',
    );
  const portText = env.PORT === undefined ? '3000' : String(env.PORT);
  if (
    !/^\d+$/.test(portText) ||
    Number(portText) < 1 ||
    Number(portText) > 65535
  )
    invalid('PORT', 'must be an integer from 1 to 65535');
  const ai = flag(env, 'AI_ENABLED', production ? undefined : true);
  const pronunciation = flag(
    env,
    'PRONUNCIATION_ENABLED',
    production ? undefined : true,
  );
  const apiKey = text(env, 'GEMINI_API_KEY');
  if (
    production &&
    ai &&
    (!apiKey || /your[_-]|placeholder|change.me/i.test(apiKey))
  )
    invalid('GEMINI_API_KEY', 'is required when AI_ENABLED=true');
  const pronunciationUrl = text(env, 'PRONUNCIATION_SERVICE_URL');
  if (production && pronunciation && !pronunciationUrl)
    invalid(
      'PRONUNCIATION_SERVICE_URL',
      'is required when PRONUNCIATION_ENABLED=true',
    );
  if (pronunciationUrl && pronunciation) {
    const url = httpUrl(pronunciationUrl, 'PRONUNCIATION_SERVICE_URL');
    if (
      production &&
      isLocalHost(url.hostname) &&
      !flag(env, 'ALLOW_LOCAL_PRONUNCIATION', false)
    )
      invalid(
        'PRONUNCIATION_SERVICE_URL',
        'requires the explicit ALLOW_LOCAL_PRONUNCIATION self-hosted override',
      );
  }
  const serviceToken =
    typeof env.PRONUNCIATION_SERVICE_TOKEN === 'string'
      ? env.PRONUNCIATION_SERVICE_TOKEN
      : '';
  if (
    (production && pronunciation && !serviceToken) ||
    (serviceToken &&
      (!/^[A-Za-z0-9_+/=-]{32,256}$/.test(serviceToken) ||
        new Set(serviceToken).size < 12 ||
        /placeholder|change.?me|your[_-]|example|default/i.test(serviceToken) ||
        serviceToken === secret))
  )
    invalid(
      'PRONUNCIATION_SERVICE_TOKEN',
      'must be a separate random service credential (32-256 characters), required when pronunciation is enabled in production',
    );
  const originsText = text(env, 'CORS_ORIGINS');
  if (production && !originsText) invalid('CORS_ORIGINS', 'is required');
  const origins = originsText
    ? originsText.split(',').map((value) => {
        const url = httpUrl(value.trim(), 'CORS_ORIGINS');
        if (url.pathname !== '/')
          invalid('CORS_ORIGINS', 'must contain origins without paths');
        if (
          production &&
          ((isLocalHost(url.hostname) &&
            !flag(env, 'ALLOW_LOCAL_ORIGINS', false)) ||
            (url.protocol !== 'https:' &&
              !(
                isLocalHost(url.hostname) &&
                flag(env, 'ALLOW_LOCAL_ORIGINS', false)
              )))
        )
          invalid(
            'CORS_ORIGINS',
            'requires HTTPS public origins or the explicit ALLOW_LOCAL_ORIGINS self-hosted override',
          );
        if (url.hostname.includes('*'))
          invalid('CORS_ORIGINS', 'must not contain wildcards');
        return url.origin;
      })
    : [];
  const upload = text(env, 'UPLOAD_ROOT');
  if (production && (!upload || !isAbsolute(upload)))
    invalid(
      'UPLOAD_ROOT',
      'must be an explicit absolute persistent storage path',
    );
  const root = resolve(upload || 'uploads');
  const temporary = resolve(tmpdir());
  if (
    production &&
    (root === parse(root).root ||
      root.includes('\0') ||
      /(?:^|[\\/])(?:tmp|temp|dist|build|node_modules|\.git)(?:[\\/]|$)/i.test(
        root,
      ) ||
      root === temporary ||
      root.startsWith(`${temporary}/`) ||
      root.startsWith(`${temporary}\\`))
  )
    invalid(
      'UPLOAD_ROOT',
      'must not use temporary, build, repository metadata or filesystem-root storage',
    );
  const boundedMilliseconds = (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) => {
    const value =
      env[name] === undefined ? String(fallback) : String(env[name]);
    if (
      !/^\d+$/.test(value) ||
      Number(value) < minimum ||
      Number(value) > maximum
    )
      invalid(name, `must be an integer from ${minimum} to ${maximum}`);
    return Number(value);
  };
  return {
    ...env,
    TIMELINE_AUTHORITY_MODE: authorityMode,
    DEPLOYMENT_PROFILE: authorityProfile,
    DATA_TIMELINE_ID: typeof timeline === 'string' ? timeline : '',
    DATA_WRITE_MODE: writeMode,
    CLIENT_PROTOCOL_POLICY:
      protocolPolicy as RuntimeConfig['CLIENT_PROTOCOL_POLICY'],
    RELEASE_BUILD_ID: buildId,
    NODE_ENV: mode as RuntimeConfig['NODE_ENV'],
    MONGODB_URI: uri,
    JWT_SECRET: secret,
    PORT: Number(portText),
    AI_ENABLED: ai,
    PRONUNCIATION_ENABLED: pronunciation,
    PRONUNCIATION_SERVICE_TOKEN: serviceToken,
    CORS_ORIGINS: [...new Set(origins)].join(','),
    UPLOAD_ROOT: root,
    TRUST_PROXY: String(proxy),
    PROVIDER_CHAT_TIMEOUT_MS: boundedMilliseconds(
      'PROVIDER_CHAT_TIMEOUT_MS',
      35000,
      500,
      60000,
    ),
    PROVIDER_WRITING_TIMEOUT_MS: boundedMilliseconds(
      'PROVIDER_WRITING_TIMEOUT_MS',
      30000,
      500,
      60000,
    ),
    PROVIDER_FLASHCARD_TIMEOUT_MS: boundedMilliseconds(
      'PROVIDER_FLASHCARD_TIMEOUT_MS',
      15000,
      500,
      60000,
    ),
    PROVIDER_FEEDBACK_TIMEOUT_MS: boundedMilliseconds(
      'PROVIDER_FEEDBACK_TIMEOUT_MS',
      8000,
      500,
      60000,
    ),
    PROVIDER_PRONUNCIATION_TIMEOUT_MS: boundedMilliseconds(
      'PROVIDER_PRONUNCIATION_TIMEOUT_MS',
      45000,
      500,
      90000,
    ),
    PROVIDER_MAX_RETRIES: boundedMilliseconds('PROVIDER_MAX_RETRIES', 0, 0, 1),
    READINESS_TIMEOUT_MS: boundedMilliseconds(
      'READINESS_TIMEOUT_MS',
      5000,
      100,
      30000,
    ),
    READINESS_RECHECK_MS: boundedMilliseconds(
      'READINESS_RECHECK_MS',
      15000,
      1000,
      60000,
    ),
    SHUTDOWN_GRACE_MS: boundedMilliseconds(
      'SHUTDOWN_GRACE_MS',
      25000,
      1000,
      120000,
    ),
    GEMINI_API_KEY: apiKey,
    PRONUNCIATION_SERVICE_URL:
      pronunciationUrl.replace(/\/+$/, '') ||
      (production ? '' : 'http://localhost:8001'),
  };
}

export function safeConfigSummary(config: Pick<ConfigService, 'get'>) {
  return {
    environment: config.get('NODE_ENV'),
    timelineAuthorityMode:
      config.get<string>('TIMELINE_AUTHORITY_MODE') ?? 'LEGACY_LOCAL',
    timelineConfigured: isTimelineId(config.get('DATA_TIMELINE_ID')),
    dataWriteMode: config.get<WriteState>('DATA_WRITE_MODE'),
    clientProtocolPolicy: config.get<RuntimeConfig['CLIENT_PROTOCOL_POLICY']>(
      'CLIENT_PROTOCOL_POLICY',
    ),
    port: config.get('PORT'),
    aiEnabled: featureEnabled(config, 'AI_ENABLED'),
    pronunciationEnabled: featureEnabled(config, 'PRONUNCIATION_ENABLED'),
    corsOriginCount: (config.get<string>('CORS_ORIGINS') || '')
      .split(',')
      .filter(Boolean).length,
    uploadRootConfigured: !!config.get('UPLOAD_ROOT'),
    mongoConfigured: !!config.get('MONGODB_URI'),
  };
}
