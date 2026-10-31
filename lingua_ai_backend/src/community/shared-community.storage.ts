import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { MutationTimeline } from '../operations/mutation-timeline';
import {
  DurableEffectContext,
  UncertainDurableEffect,
} from '../operations/durable-authority';
import { S3ObjectStorage, objectConfig, objectKey } from './object-storage';

export interface StoredObject {
  id: string;
  public_name: string;
  environment: string;
  namespace: string;
  bucket: string;
  storage_identity: string;
  object_key: string;
  timeline_id: string;
  generation: string;
  verified_timeline: string;
  verified_generation: string;
  owner_hash: string;
  sha256: string;
  bytes: number;
  content_type: string;
  version_id: string | null;
  status: string;
  delete_operation: string | null;
  create_effect: string;
  delete_effect: string | null;
}
const digest = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
@Injectable()
export class SharedCommunityStorage {
  readonly adapter?: S3ObjectStorage;
  private active = 0;
  constructor(
    private readonly config: ConfigService,
    private readonly timeline: MutationTimeline,
    @InjectConnection() private readonly mongo: Connection,
  ) {
    if (this.enabled())
      this.adapter = new S3ObjectStorage(
        objectConfig(
          Object.fromEntries(
            [
              'OBJECT_STORAGE_ENDPOINT',
              'OBJECT_STORAGE_BUCKET',
              'OBJECT_STORAGE_NAMESPACE',
              'OBJECT_STORAGE_IDENTITY',
              'OBJECT_STORAGE_ACCESS_KEY',
              'OBJECT_STORAGE_SECRET_KEY',
              'TIMELINE_AUTHORITY_ENVIRONMENT',
              'READINESS_TIMEOUT_MS',
            ].map((k) => [k, this.config.get(k)]),
          ),
        ),
      );
  }
  enabled() {
    return this.config.get('UPLOAD_STORAGE_BACKEND') === 'S3';
  }
  private unavailable() {
    return new ServiceUnavailableException({
      code: 'BACKEND_NOT_READY',
      message: 'Backend is temporarily unavailable.',
    });
  }
  private async query<T>(sql: string, values: unknown[] = []): Promise<T> {
    if (this.active >= 8) throw this.unavailable();
    this.active++;
    const timeout = this.config.get<number>('READINESS_TIMEOUT_MS') ?? 5000;
    const client = new Client({
      connectionString: this.config.getOrThrow('TIMELINE_AUTHORITY_URL'),
      connectionTimeoutMillis: timeout,
      query_timeout: timeout,
      statement_timeout: timeout,
    });
    client.on('error', () => undefined);
    try {
      await client.connect();
      return (await client.query<{ value: T }>(sql, values)).rows[0]?.value;
    } finally {
      this.active--;
      await client.end().catch(() => undefined);
    }
  }
  async lookup(name: string) {
    if (!/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(name))
      throw new NotFoundException();
    return this.query<StoredObject | null>(
      'SELECT timeline_authority.object_lookup($1) AS value',
      [name],
    );
  }
  private async record(
    row: StoredObject,
    ctx: DurableEffectContext,
    action: string,
    operation?: string,
    owner?: string,
  ) {
    await ctx.client.query(
      'SELECT timeline_authority.object_record($1,$2,$3,$4,$5,$6)',
      [
        row.id,
        ctx.effectId,
        action,
        null,
        operation ?? null,
        owner ? digest(owner) : null,
      ],
    );
  }
  async checkAvailability() {
    if (!this.adapter) throw this.unavailable();
    await this.adapter.checkAvailability();
    // A missing/old ledger schema or wrong binding never falls back to disk.
    const c = this.adapter.config;
    const bound = await this.query<boolean>(
      'SELECT timeline_authority.object_binding_matches($1,$2,$3,$4) AS value',
      [c.environment, c.namespace, c.bucket, c.storageIdentity],
    );
    if (bound !== true) throw this.unavailable();
    if (
      (await this.query<boolean>(
        'SELECT timeline_authority.object_reconciled() AS value',
      )) !== true
    )
      throw this.unavailable();
  }
  async create(image: { buffer: Buffer; extension: string }, owner: string) {
    if (!owner || !this.adapter) throw this.unavailable();
    const scope = await this.timeline.fresh();
    const id = randomUUID(),
      name = id + '.' + image.extension,
      c = this.adapter.config;
    const key = objectKey(
      c,
      scope.dataTimelineId,
      Number(this.config.get('TIMELINE_AUTHORITY_GENERATION')),
      name,
    );
    const contentType =
      image.extension === 'jpg' ? 'image/jpeg' : 'image/' + image.extension;
    return this.timeline.fileEffect(
      'upload-store',
      async (check, ctx) => {
        if (!ctx) throw this.unavailable();
        await this.checkAvailability();
        await check();
        await ctx.client.query(
          'SELECT timeline_authority.object_begin($1::jsonb,$2::uuid)',
          [
            JSON.stringify({
              id,
              publicName: name,
              environment: c.environment,
              namespace: c.namespace,
              bucket: c.bucket,
              storageIdentity: c.storageIdentity,
              key,
              ownerHash: digest(owner),
              sha256: digest(image.buffer),
              bytes: image.buffer.length,
              contentType,
            }),
            ctx.effectId,
          ],
        );
        await check();
        // Any uncertainty after dispatch conservatively retains the C1 permit.
        try {
          const info = await this.adapter!.createImmutable(
            key,
            image.buffer,
            contentType,
          );
          await ctx.client.query(
            'SELECT timeline_authority.object_record($1,$2,$3,$4)',
            [id, ctx.effectId, 'STORED', info.version],
          );
        } catch {
          throw new UncertainDurableEffect();
        }
        return '/uploads/community/' + name;
      },
      scope,
    );
  }
  async retain(url: string) {
    const row = await this.lookup(url.split('/').pop()!);
    if (
      !row ||
      row.status === 'LINKED' ||
      row.status === 'DELETE_PENDING' ||
      row.status === 'DELETED'
    )
      return;
    await this.timeline.fileEffect('upload-store', async (check, ctx) => {
      if (!ctx) throw this.unavailable();
      await check();
      await this.record(row, ctx, 'LINKED');
    });
  }
  async prepareDelete(url: string, operation: string, owner: string) {
    const row = await this.lookup(url.split('/').pop()!);
    if (!row) throw this.unavailable(); // Legacy references require explicit verified migration.
    await this.timeline.fileEffect('upload-remove', async (check, ctx) => {
      if (!ctx) throw this.unavailable();
      await check();
      await this.record(row, ctx, 'DELETE_PENDING', operation, owner);
    });
  }
  async remove(url: string) {
    const row = await this.lookup(url.split('/').pop()!);
    if (!row || row.status === 'DELETED') return;
    // Upload orphans never acquire deletion authority from mere DB absence.
    if (row.status !== 'DELETE_PENDING') return;
    const scope = await this.timeline.fresh();
    if (
      row.verified_timeline !== scope.dataTimelineId ||
      Number(row.verified_generation) !==
        Number(this.config.get('TIMELINE_AUTHORITY_GENERATION'))
    )
      throw this.unavailable();
    await this.timeline.fileEffect(
      'upload-remove',
      async (check, ctx) => {
        if (!ctx) throw this.unavailable();
        await this.checkAvailability();
        if (
          await this.mongo
            .db!.collection('communityposts')
            .findOne({ imageUrl: url }, { timeoutMS: 5000 })
        )
          return;
        await check();
        const claim = await ctx.client.query<{ claimed: boolean }>(
          'SELECT timeline_authority.object_claim_delete($1,$2) AS claimed',
          [row.id, ctx.effectId],
        );
        // Another live permit owns dispatch, or it already completed. Never
        // issue a second request or turn an ordinary concurrent retry uncertain.
        if (claim.rows[0]?.claimed !== true) return;
        await check();
        try {
          await this.adapter!.delete(row.object_key);
          await this.record(row, ctx, 'DELETED');
        } catch {
          throw new UncertainDurableEffect();
        }
      },
      scope,
    );
  }
  async read(url: string) {
    try {
      const name = url.split('/').pop()!,
        row = await this.lookup(name);
      if (!row || !row.version_id) throw new NotFoundException();
      const control = await this.timeline.gate.assertWritesPermitted();
      if (
        row.verified_timeline !== control.dataTimelineId ||
        Number(row.verified_generation) !==
          Number(this.config.get('TIMELINE_AUTHORITY_GENERATION'))
      )
        throw this.unavailable();
      // All authenticated community members can see referenced feed images.
      if (
        !(await this.mongo
          .db!.collection('communityposts')
          .findOne({ imageUrl: url }, { timeoutMS: 5000 }))
      )
        throw new NotFoundException();
      await this.checkAvailability();
      const info = await this.adapter!.head(row.object_key, row.version_id);
      if (
        info.sha256 !== row.sha256 ||
        info.size !== row.bytes ||
        info.contentType !== row.content_type
      )
        throw this.unavailable();
      const buffer = await this.adapter!.read(row.object_key, row.version_id);
      if (digest(buffer) !== row.sha256) throw this.unavailable();
      return { buffer, contentType: row.content_type };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw this.unavailable();
    }
  }
}
