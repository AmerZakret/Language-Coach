import {
  targetLanguageCode,
  targetLanguageQuery,
  tryTargetLanguage,
} from '../common/target-language';
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  CommunityPost,
  CommunityPostDocument,
} from './schemas/community-post.schema';
import { User } from '../users/schemas/user.schema';
import { CommunityImageStorage } from './community-image.storage';

import { createHash } from 'node:crypto';
import { MutationReceipts } from '../common/mutation-receipt';
import { telemetry } from '../operations/telemetry';

@Injectable()
export class CommunityService {
  constructor(
    @InjectModel(CommunityPost.name)
    private readonly communityPostModel: Model<CommunityPostDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly receipts: MutationReceipts,
    @Optional()
    private readonly images: CommunityImageStorage = new CommunityImageStorage(),
  ) {}

  private async cleanupUnreferenced(
    imageUrl: string | undefined,
    operation: string,
  ): Promise<void> {
    if (!imageUrl) return;
    try {
      // A lost DB acknowledgement must not cause deletion of a committed image.
      // Historical shared references also remain valid. Uncertain DB state is
      // preserved for manual reconciliation, never guessed to mean "unreferenced".
      if (await this.communityPostModel.exists({ imageUrl }).exec()) {
        this.images.retain(imageUrl);
        return;
      }
    } catch {
      this.images.retain(imageUrl);
      telemetry.emit(
        'upload.cleanup_failed',
        { domain: operation, failureCategory: 'reference_check_unavailable' },
        'warn',
      );
      return;
    }
    await this.images.cleanup(imageUrl, operation);
  }

  private fingerprint(image?: Express.Multer.File) {
    return image
      ? {
          imageHash: createHash('sha256').update(image.buffer).digest('hex'),
          imageMime: image.mimetype,
          imageExtension: image.originalname.split('.').pop()?.toLowerCase(),
        }
      : {};
  }

  async create(
    userId: string,
    userName: string,
    learningLanguage: string,
    text?: string,
    image?: Express.Multer.File,
    operationId?: string,
  ) {
    if (!text && !image)
      throw new BadRequestException(
        'Post must contain either text or an image',
      );
    const language = targetLanguageCode(learningLanguage);
    let imageUrl: string | undefined;
    try {
      return await this.receipts.execute(
        userId,
        operationId,
        'community-create',
        { language, text, ...this.fingerprint(image) },
        async (session) => {
          // The unique transaction claim precedes file allocation. Reuse the file
          // on a transaction callback retry; a completed replay never stores one.
          return new this.communityPostModel({
            userId,
            userName,
            learningLanguage: language,
            text,
            imageUrl,
            likes: [],
            likesCount: 0,
            revision: 0,
          }).save({ session });
        },
        image
          ? async () => {
              imageUrl = await this.images.store(image);
            }
          : undefined,
      );
    } finally {
      await this.cleanupUnreferenced(imageUrl, 'create reconciliation');
    }
  }

  async findAll(
    currentUserId: string,
    page = 1,
    limit = 10,
    language?: string,
  ): Promise<{
    items: any[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  }> {
    const query: Record<string, unknown> = {};
    if (
      language &&
      language.trim() !== '' &&
      language.toLowerCase() !== 'all'
    ) {
      // Direct exact match, or case-insensitive if needed
      query.learningLanguage = targetLanguageQuery(language);
    }

    const total = await this.communityPostModel.countDocuments(query);
    const rawItems = await this.communityPostModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    // Fetch users in batch to get latest names (only query valid ObjectIds)
    const userIds = [
      ...new Set(
        rawItems
          .map((post) => post.userId)
          .filter((id) => id && Types.ObjectId.isValid(id)),
      ),
    ];
    const users = await this.userModel.find({ _id: { $in: userIds } }).exec();
    const userMap = new Map<string, string>();
    for (const u of users) {
      userMap.set(u._id.toString(), u.name);
    }

    const items = rawItems.map((post) => {
      const obj = post.toObject();
      const currentUserName = userMap.get(post.userId) || post.userName;
      return {
        ...obj,
        learningLanguage:
          tryTargetLanguage(obj.learningLanguage) ?? obj.learningLanguage,
        userName: currentUserName,
        likedByMe: post.likes.includes(currentUserId),
      };
    });

    const hasMore = page * limit < total;

    return {
      items,
      page,
      limit,
      total,
      hasMore,
    };
  }

  async findOne(id: string): Promise<CommunityPost> {
    const post = await this.communityPostModel.findById(id).exec();
    if (!post) {
      throw new NotFoundException('Community post not found');
    }
    return post;
  }

  private async owned(id: string, userId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid post ID');
    const post = await this.communityPostModel
      .findById(id)
      .session(session ?? null)
      .exec();
    if (!post) throw new NotFoundException('Community post not found');
    if (post.userId !== userId)
      throw new ForbiddenException("Cannot mutate another user's post");
    return post;
  }

  async update(
    id: string,
    userId: string,
    text?: string,
    removeImage?: boolean,
    image?: Express.Multer.File,
    operationId?: string,
    expectedRevision?: number,
  ) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision! < 0)
      throw new BadRequestException({
        code: 'INVALID_RESOURCE_REVISION',
        message: 'Expected revision is required',
      });
    let newImageUrl: string | undefined, oldImageUrl: string | undefined;
    let committed = false;
    try {
      const result = await this.receipts.execute(
        userId,
        operationId,
        'community-update',
        {
          id,
          text,
          removeImage: !!removeImage,
          expectedRevision,
          ...this.fingerprint(image),
        },
        async (session) => {
          const post = await this.owned(id, userId, session);
          if ((post.revision ?? 0) !== expectedRevision)
            throw new ConflictException({
              code: 'STALE_RESOURCE_REVISION',
              message: 'Post changed. Refresh before editing.',
            });
          oldImageUrl = post.imageUrl;
          const nextText = text === undefined ? post.text : text;
          if (!nextText && !image && (removeImage || !oldImageUrl))
            throw new BadRequestException('Post cannot be empty');
          if (text !== undefined) post.text = text;
          if (newImageUrl || removeImage) post.imageUrl = newImageUrl;
          post.revision = expectedRevision! + 1;
          return post.save({ session });
        },
        image
          ? async () => {
              const post = await this.owned(id, userId);
              if ((post.revision ?? 0) !== expectedRevision)
                throw new ConflictException({
                  code: 'STALE_RESOURCE_REVISION',
                  message: 'Post changed. Refresh before editing.',
                });
              newImageUrl = await this.images.store(image);
            }
          : undefined,
      );
      committed = true;
      return result;
    } finally {
      await this.cleanupUnreferenced(newImageUrl, 'update reconciliation');
      if (committed && (newImageUrl || removeImage))
        await this.cleanupUnreferenced(oldImageUrl, 'replaced image');
    }
  }

  async delete(
    id: string,
    userId: string,
    operationId?: string,
    expectedRevision?: number,
  ) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision! < 0)
      throw new BadRequestException({
        code: 'INVALID_RESOURCE_REVISION',
        message: 'Expected revision is required',
      });
    let imageUrl: string | undefined;
    const result = await this.receipts.execute(
      userId,
      operationId,
      'community-delete',
      { id, expectedRevision },
      async (session) => {
        const post = await this.owned(id, userId, session);
        if ((post.revision ?? 0) !== expectedRevision)
          throw new ConflictException({
            code: 'STALE_RESOURCE_REVISION',
            message: 'Post changed. Refresh before deleting.',
          });
        imageUrl = post.imageUrl;
        await this.communityPostModel
          .deleteOne({ _id: id, userId }, { session })
          .exec();
        return { success: true };
      },
    );
    await this.cleanupUnreferenced(imageUrl, 'deleted post');
    return result;
  }

  async setLike(
    id: string,
    userId: string,
    liked: boolean,
    operationId?: string,
  ) {
    if (typeof liked !== 'boolean')
      throw new BadRequestException('liked must be a boolean');
    return this.receipts.execute(
      userId,
      operationId,
      'community-reaction',
      { id, liked },
      async (session) => {
        if (!Types.ObjectId.isValid(id))
          throw new BadRequestException('Invalid post ID');
        const post = await this.communityPostModel
          .findByIdAndUpdate(
            id,
            [
              {
                $set: {
                  likes: liked
                    ? { $setUnion: [{ $ifNull: ['$likes', []] }, [userId]] }
                    : {
                        $setDifference: [{ $ifNull: ['$likes', []] }, [userId]],
                      },
                },
              },
              { $set: { likesCount: { $size: '$likes' } } },
            ],
            { session, returnDocument: 'after', updatePipeline: true },
          )
          .exec();
        if (!post) throw new NotFoundException('Community post not found');
        return {
          likesCount: post.likesCount,
          likedByMe: post.likes.includes(userId),
        };
      },
    );
  }
}
