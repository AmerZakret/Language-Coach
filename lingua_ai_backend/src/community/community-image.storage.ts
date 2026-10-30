import { MutationTimeline } from '../operations/mutation-timeline';
import {
  BadRequestException,
  Injectable,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  open,
  mkdir,
  realpath,
  lstat,
  unlink,
  readFile,
} from 'node:fs/promises';
import {
  extname,
  join,
  resolve,
  relative,
  isAbsolute,
  dirname,
  basename,
  sep,
} from 'node:path';
import sharp from 'sharp';
import { telemetry } from '../operations/telemetry';

export const COMMUNITY_IMAGE_LIMIT = 5 * 1024 * 1024;
export const COMMUNITY_PIXEL_LIMIT = 16_000_000;
export const COMMUNITY_IMAGE_PREFIX = '/uploads/community/';
type RasterFormat = 'jpeg' | 'png' | 'webp';
const extensions = { jpeg: 'jpg', png: 'png', webp: 'webp' } as const;
// Retain access to historical server-generated raster names, but never serve
// arbitrary files (including HTML/SVG left by the old MIME-only uploader).
export const COMMUNITY_IMAGE_NAME =
  /^(?:[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}|post-\d+-\d+)\.(?:jpg|jpeg|png|webp)$/i;

export function resolveUploadRoot(): string {
  return resolve(
    process.env.UPLOAD_ROOT?.trim() || join(process.cwd(), 'uploads'),
  );
}
function contains(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}
function detectedFormat(buffer: Buffer): RasterFormat | undefined {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'png';
  if (
    buffer.length >= 3 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  )
    return 'jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    buffer.readUInt32LE(4) === buffer.length - 8
  )
    return 'webp';
}

@Injectable()
export class CommunityImageStorage {
  constructor(@Optional() private readonly timeline?: MutationTimeline) {}
  private readonly staged = new Map<string, string>();
  retain(imageUrl: string) {
    this.staged.delete(imageUrl);
  }
  private async admitFileWrite() {
    if (!this.timeline)
      throw new ServiceUnavailableException({
        code: 'BACKEND_NOT_READY',
        message: 'Backend is temporarily unavailable.',
      });
    await this.timeline.fresh();
  }
  private async fileEffect<T>(
    kind: 'upload-store' | 'upload-remove',
    work: (check: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    if (!this.timeline)
      throw new ServiceUnavailableException({
        code: 'BACKEND_NOT_READY',
        message: 'Backend is temporarily unavailable.',
      });
    return this.timeline.fileEffect(kind, work);
  }
  readonly root = resolveUploadRoot();
  private readonly verified = new Map<string, string>();

  async normalize(
    file: Express.Multer.File,
  ): Promise<{ buffer: Buffer; extension: string }> {
    if (!Buffer.isBuffer(file.buffer) || !file.buffer.length)
      throw new BadRequestException('Invalid image content');
    if (file.buffer.length > COMMUNITY_IMAGE_LIMIT)
      throw new PayloadTooLargeException('Image exceeds 5 MB');
    const format = detectedFormat(file.buffer);
    const extension = extname(file.originalname).toLowerCase();
    const allowedExtensions =
      format === 'jpeg' ? ['.jpg', '.jpeg'] : [`.${format}`];
    const allowedMimes =
      format === 'jpeg' ? ['image/jpeg', 'image/jpg'] : [`image/${format}`];
    if (
      !format ||
      !allowedExtensions.includes(extension) ||
      !allowedMimes.includes(file.mimetype.toLowerCase())
    )
      throw new BadRequestException(
        'Image content, MIME and extension must agree: JPEG, PNG or WebP',
      );
    try {
      const image = sharp(file.buffer, {
        failOn: 'warning',
        limitInputPixels: COMMUNITY_PIXEL_LIMIT,
      }).timeout({ seconds: 5 });
      const metadata = await image.metadata();
      if (
        metadata.format !== format ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages || 1) !== 1
      )
        throw new Error('Invalid or animated image');
      // Decode and re-encode: reject corrupt pixels and discard original metadata
      // and trailing/polyglot content. Preserve EXIF orientation in the pixels.
      const buffer = await image.rotate().toFormat(format).toBuffer();
      if (buffer.length > COMMUNITY_IMAGE_LIMIT)
        throw new PayloadTooLargeException('Normalized image exceeds 5 MB');
      return { buffer, extension: extensions[format] };
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw error;
      throw new BadRequestException(
        'Invalid, animated or oversized image dimensions',
      );
    }
  }

  private candidate(imageUrl: string): string {
    if (!imageUrl.startsWith(COMMUNITY_IMAGE_PREFIX))
      throw new Error('Unsafe image reference');
    const name = imageUrl.slice(COMMUNITY_IMAGE_PREFIX.length);
    if (!COMMUNITY_IMAGE_NAME.test(name))
      throw new Error('Unsafe image filename');
    const candidate = resolve(this.root, 'community', name);
    if (!contains(this.root, candidate))
      throw new Error('Image outside upload root');
    return candidate;
  }

  private async checkDirectory(candidate: string): Promise<void> {
    const root = await realpath(this.root);
    const parent = await realpath(dirname(candidate));
    if (!contains(root, parent))
      throw new Error('Image directory outside upload root');
  }

  async store(file: Express.Multer.File): Promise<string> {
    const image = await this.normalize(file);
    return this.fileEffect('upload-store', async (check) => {
      await this.admitFileWrite();
      await check();
      await mkdir(join(this.root, 'community'), { recursive: true });
      for (let attempt = 0; attempt < 3; attempt++) {
        const url = `${COMMUNITY_IMAGE_PREFIX}${randomUUID()}.${image.extension}`;
        const candidate = this.candidate(url);
        await this.checkDirectory(candidate);
        await this.admitFileWrite();
        let handle;
        try {
          await check();
          handle = await open(candidate, 'wx', 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw error;
        }
        try {
          await check();
          await handle.writeFile(image.buffer);
          await handle.close();
          const stat = await lstat(candidate);
          this.staged.set(url, `${stat.dev}:${stat.ino}`);
          return url;
        } catch (error) {
          await handle.close().catch(() => {});
          const stat = await lstat(candidate).catch(() => undefined);
          if (stat) this.staged.set(url, `${stat.dev}:${stat.ino}`);
          await this.cleanup(url, 'failed file write');
          throw error;
        }
      }
      throw new ServiceUnavailableException(
        'Unable to allocate image filename',
      );
    });
  }

  async remove(imageUrl: string): Promise<void> {
    if (this.timeline?.durableRequired())
      return this.fileEffect('upload-remove', (check) =>
        this.removeFile(imageUrl, check),
      );
    return this.removeFile(imageUrl); // Legacy owned-file compensation remains compatible.
  }
  private async removeFile(
    imageUrl: string,
    check: () => Promise<void> = () => Promise.resolve(),
  ): Promise<void> {
    const candidate = this.candidate(imageUrl);
    try {
      await this.checkDirectory(candidate);
      const stat = await lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new Error('Unsafe image file');
      const owned = this.staged.get(imageUrl);
      if (owned !== undefined) {
        if (owned !== `${stat.dev}:${stat.ino}`)
          throw new Error('Staged image identity changed');
      } else {
        await this.admitFileWrite();
      }
      await check();
      await unlink(candidate);
      this.staged.delete(imageUrl);
      this.verified.delete(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  // Also protect historical uploads, rather than assuming the old MIME-only
  // uploader produced safe content. Cache only bounded file fingerprints.
  async assertServeable(imageUrl: string): Promise<void> {
    const candidate = this.candidate(imageUrl);
    await this.checkDirectory(candidate);
    const stat = await lstat(candidate);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > COMMUNITY_IMAGE_LIMIT
    )
      throw new Error('Unsafe image file');
    const fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    if (this.verified.get(candidate) === fingerprint) return;
    const extension = extname(candidate).toLowerCase();
    await this.normalize({
      buffer: await readFile(candidate),
      originalname: basename(candidate),
      mimetype: ['.jpg', '.jpeg'].includes(extension)
        ? 'image/jpeg'
        : `image/${extension.slice(1)}`,
    } as Express.Multer.File);
    if (this.verified.size >= 128) {
      const oldest = this.verified.keys().next();
      if (!oldest.done) this.verified.delete(oldest.value);
    }
    this.verified.set(candidate, fingerprint);
  }

  async cleanup(
    imageUrl: string | undefined,
    operation: string,
  ): Promise<void> {
    if (!imageUrl) return;
    try {
      await this.remove(imageUrl);
    } catch (error) {
      // Cleanup is best effort. Preserve the original application error or the
      // successful DB result; do not log arbitrary stored paths or file bytes.
      const code = (error as NodeJS.ErrnoException).code;
      telemetry.emit(
        'upload.cleanup_failed',
        {
          domain: operation,
          failureCategory: 'filesystem_or_containment',
          code:
            code &&
            [
              'EACCES',
              'EPERM',
              'ENOSPC',
              'EROFS',
              'ENOENT',
              'EIO',
              'EXDEV',
            ].includes(code)
              ? code
              : 'UNCLASSIFIED',
        },
        'warn',
      );
    } finally {
      this.staged.delete(imageUrl);
    }
  }
}
