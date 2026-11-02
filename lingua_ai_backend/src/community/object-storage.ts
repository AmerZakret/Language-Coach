import { createHash, createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isTimelineId } from '../operations/timeline-contract';

export const OBJECT_LIMIT = 5 * 1024 * 1024;
export interface ObjectInfo {
  size: number;
  contentType: string;
  sha256: string;
  version: string;
}
/** Exact-key operations only: no listing, public URLs, ACLs or control mutation. */
export interface ObjectStorage {
  createImmutable(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<ObjectInfo>;
  read(key: string, version: string): Promise<Buffer>;
  head(key: string, version: string): Promise<ObjectInfo>;
  delete(key: string): Promise<void>;
  checkAvailability(): Promise<void>;
  verifyIdentity(): Promise<void>;
}
export interface ObjectConfig {
  endpoint: string;
  bucket: string;
  namespace: string;
  environment: string;
  storageIdentity: string;
  accessKey: string;
  secretKey: string;
  timeout: number;
}
const publicId = /^[a-z][a-z0-9-]{2,62}$/;
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
const hash = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value).digest();
export class ObjectRequestError extends Error {
  constructor(
    readonly uncertain = false,
    readonly status = 0,
  ) {
    super('OBJECT_STORAGE_UNAVAILABLE');
  }
}
export function objectConfig(env: Record<string, unknown>): ObjectConfig {
  const value = (name: string) =>
    typeof env[name] === 'string' ? String(env[name]) : '';
  const endpoint = value('OBJECT_STORAGE_ENDPOINT');
  const url = new URL(endpoint);
  const bucket = value('OBJECT_STORAGE_BUCKET'),
    namespace = value('OBJECT_STORAGE_NAMESPACE');
  const environment = value('TIMELINE_AUTHORITY_ENVIRONMENT'),
    storageIdentity = value('OBJECT_STORAGE_IDENTITY');
  const accessKey = value('OBJECT_STORAGE_ACCESS_KEY'),
    secretKey = value('OBJECT_STORAGE_SECRET_KEY');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && url.hostname !== 'object-store') ||
    !publicId.test(bucket) ||
    !publicId.test(namespace) ||
    !/^[a-z][a-z0-9._-]{0,63}$/.test(environment) ||
    !/^[a-z][a-z0-9._-]{0,95}$/.test(storageIdentity) ||
    !/^[A-Za-z0-9]{16,64}$/.test(accessKey) ||
    !/^[A-Za-z0-9+/=_-]{32,128}$/.test(secretKey) ||
    accessKey === secretKey
  )
    throw new Error('INVALID_OBJECT_STORAGE_CONFIGURATION');
  const timeout = Number(env.READINESS_TIMEOUT_MS ?? 5000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30000)
    throw new Error('INVALID_OBJECT_STORAGE_CONFIGURATION');
  return {
    endpoint: url.origin,
    bucket,
    namespace,
    environment,
    storageIdentity,
    accessKey,
    secretKey,
    timeout,
  };
}
export function objectKey(
  c: ObjectConfig,
  timeline: string,
  generation: number,
  filename: string,
) {
  if (
    !isTimelineId(timeline) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(filename) ||
    !isTimelineId(filename.split('.')[0])
  )
    throw new Error('INVALID_OBJECT_KEY');
  return `${c.namespace}/${c.environment}/${timeline}/${generation}/${filename}`;
}
export function storageIdentityBody(c: ObjectConfig) {
  return JSON.stringify({
    schema: 1,
    bucket: c.bucket,
    namespace: c.namespace,
    environment: c.environment,
    storageIdentity: c.storageIdentity,
    versioning: 'Enabled',
  });
}
/** Small S3 REST subset, SigV4, one attempt, fixed endpoint, bounded responses. */
export class S3ObjectStorage implements ObjectStorage {
  private active = 0;
  constructor(readonly config: ObjectConfig) {}
  async request(
    method: string,
    key = '',
    query: Record<string, string> = {},
    body: Buffer = Buffer.alloc(0),
    extra: Record<string, string> = {},
    maximum = OBJECT_LIMIT,
  ) {
    if (this.active >= 8) throw new ObjectRequestError();
    this.active++;
    try {
      const c = this.config,
        url = new URL(c.endpoint);
      const pathname =
        '/' +
        encode(c.bucket) +
        (key ? '/' + key.split('/').map(encode).join('/') : '');
      const search = Object.entries(query)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => encode(k) + '=' + encode(v))
        .join('&');
      const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''),
        day = date.slice(0, 8);
      const headers: Record<string, string> = {
        host: url.host,
        'x-amz-content-sha256': hash(body),
        'x-amz-date': date,
        ...extra,
      };
      const keys = Object.keys(headers).sort(),
        signed = keys.join(';');
      const canonical = [
        method,
        pathname,
        search,
        keys.map((k) => k + ':' + headers[k].trim() + '\n').join(''),
        signed,
        hash(body),
      ].join('\n');
      const scope = `${day}/us-east-1/s3/aws4_request`;
      const signingKey = hmac(
        hmac(hmac(hmac('AWS4' + c.secretKey, day), 'us-east-1'), 's3'),
        'aws4_request',
      );
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${hmac(signingKey, ['AWS4-HMAC-SHA256', date, scope, hash(canonical)].join('\n')).toString('hex')}`;
      const mutating = ['PUT', 'DELETE', 'POST'].includes(method);
      return await new Promise<{
        body: Buffer;
        headers: import('node:http').IncomingHttpHeaders;
        status: number;
      }>((resolve, reject) => {
        let sent = false,
          done = false;
        const fail = () => {
          if (!done) {
            done = true;
            reject(new ObjectRequestError(mutating && sent));
          }
        };
        const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          {
            hostname: url.hostname,
            port: url.port || undefined,
            method,
            path: pathname + (search ? '?' + search : ''),
            headers,
            maxHeaderSize: 16384,
          },
          (res) => {
            const buffers: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > maximum) {
                res.destroy();
                req.destroy();
                fail();
              } else buffers.push(chunk);
            });
            res.on('error', fail);
            res.on('end', () => {
              if (done) return;
              done = true;
              const status = res.statusCode || 0;
              if (status < 200 || status >= 300)
                reject(
                  new ObjectRequestError(mutating && status >= 500, status),
                );
              else
                resolve({
                  body: Buffer.concat(buffers),
                  headers: res.headers,
                  status,
                });
            });
          },
        );
        const timer = setTimeout(() => {
          req.destroy();
          fail();
        }, c.timeout);
        req.once('close', () => clearTimeout(timer));
        req.on('error', fail);
        req.on('finish', () => {
          sent = true;
        });
        req.end(body);
      });
    } finally {
      this.active--;
    }
  }
  private key(key: string) {
    const prefix = `${this.config.namespace}/${this.config.environment}/`;
    if (
      !key.startsWith(prefix) ||
      !/^[a-zA-Z0-9/._-]{1,384}$/.test(key) ||
      key.includes('..') ||
      key.includes('//')
    )
      throw new Error('INVALID_OBJECT_KEY');
    const pieces = key.slice(prefix.length).split('/');
    if (
      pieces.length !== 3 ||
      !isTimelineId(pieces[0]) ||
      !/^[1-9][0-9]{0,15}$/.test(pieces[1]) ||
      !Number.isSafeInteger(Number(pieces[1])) ||
      !/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(pieces[2]) ||
      !isTimelineId(pieces[2].split('.')[0])
    )
      throw new Error('INVALID_OBJECT_KEY');
  }
  private version(version: string) {
    if (!/^[A-Za-z0-9._~-]{1,256}$/.test(version) || version === 'null')
      throw new Error('INVALID_OBJECT_VERSION');
  }
  private info(headers: import('node:http').IncomingHttpHeaders): ObjectInfo {
    const size = Number(headers['content-length']),
      contentType = String(headers['content-type']),
      sha256 = String(headers['x-amz-meta-sha256']),
      version = String(headers['x-amz-version-id']);
    this.version(version);
    if (
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > OBJECT_LIMIT ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(contentType) ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new Error('INVALID_OBJECT_METADATA');
    return { size, contentType, sha256, version };
  }
  async createImmutable(key: string, body: Buffer, contentType: string) {
    this.key(key);
    if (
      !body.length ||
      body.length > OBJECT_LIMIT ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(contentType)
    )
      throw new Error('INVALID_OBJECT_METADATA');
    const sha256 = hash(body);
    const r = await this.request('PUT', key, {}, body, {
      'content-type': contentType,
      'x-amz-meta-sha256': sha256,
      'if-none-match': '*',
      'cache-control': 'private, no-store',
      'content-disposition': 'inline',
    });
    const version = String(r.headers['x-amz-version-id']);
    this.version(version);
    return { size: body.length, contentType, sha256, version };
  }
  async read(key: string, version: string) {
    this.key(key);
    this.version(version);
    const r = await this.request('GET', key, { versionId: version });
    const info = this.info(r.headers);
    if (
      info.version !== version ||
      r.body.length !== info.size ||
      hash(r.body) !== info.sha256
    )
      throw new Error('OBJECT_CHECKSUM_MISMATCH');
    return r.body;
  }
  async head(key: string, version: string) {
    this.key(key);
    this.version(version);
    return this.info(
      (await this.request('HEAD', key, { versionId: version })).headers,
    );
  }
  async delete(key: string) {
    this.key(key);
    await this.request(
      'DELETE',
      key,
    ); /* Marker only: never DeleteObjectVersion. */
  }
  async verifyIdentity() {
    const identity = await this.request(
      'GET',
      'control/identity.json',
      {},
      Buffer.alloc(0),
      {},
      2048,
    );
    if (identity.body.toString() !== storageIdentityBody(this.config))
      throw new Error('OBJECT_STORAGE_IDENTITY_MISMATCH');
    const versioning = await this.request(
      'GET',
      '',
      { versioning: '' },
      Buffer.alloc(0),
      {},
      2048,
    );
    if (!/<Status>Enabled<\/Status>/.test(versioning.body.toString()))
      throw new Error('OBJECT_VERSIONING_REQUIRED');
  }
  checkAvailability() {
    return this.verifyIdentity();
  }
}
