import { targetLanguageCode, targetLanguageQuery, tryTargetLanguage } from '../common/target-language';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Optional, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommunityPost, CommunityPostDocument } from './schemas/community-post.schema';
import { User } from '../users/schemas/user.schema';
import { CommunityImageStorage } from './community-image.storage';

@Injectable()
export class CommunityService {
  private readonly logger = new Logger(CommunityService.name);
  constructor(
    @InjectModel(CommunityPost.name)
    private readonly communityPostModel: Model<CommunityPostDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @Optional() private readonly images: CommunityImageStorage = new CommunityImageStorage(),
  ) {}

  private async cleanupUnreferenced(imageUrl: string | undefined, operation: string): Promise<void> {
    if (!imageUrl) return;
    try {
      // A lost DB acknowledgement must not cause deletion of a committed image.
      // Historical shared references also remain valid. Uncertain DB state is
      // preserved for manual reconciliation, never guessed to mean "unreferenced".
      if (await this.communityPostModel.exists({ imageUrl }).exec()) return;
    } catch {
      this.logger.error(`Community image cleanup deferred (${operation}): DB state unavailable`);
      return;
    }
    await this.images.cleanup(imageUrl, operation);
  }

  async create(
    userId: string,
    userName: string,
    learningLanguage: string,
    text?: string,
    image?: Express.Multer.File,
  ): Promise<CommunityPost> {
    if (!text && !image) {
      throw new BadRequestException('Post must contain either text or an image');
    }

    const language = targetLanguageCode(learningLanguage);
    const imageUrl = image ? await this.images.store(image) : undefined;
    try {
      const newPost = new this.communityPostModel({ userId, userName, learningLanguage: language,
        text, imageUrl, likes: [], likesCount: 0 });
      return await newPost.save();
    } catch (error) {
      await this.cleanupUnreferenced(imageUrl, 'failed create');
      throw error;
    }
  }

  async findAll(
    currentUserId: string,
    page = 1,
    limit = 10,
    language?: string,
  ): Promise<{ items: any[]; page: number; limit: number; total: number; hasMore: boolean }> {
    const query: any = {};
    if (language && language.trim() !== '' && language.toLowerCase() !== 'all') {
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
    const userIds = [...new Set(rawItems.map((post) => post.userId).filter((id) => id && Types.ObjectId.isValid(id)))];
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
        learningLanguage: tryTargetLanguage(obj.learningLanguage) ?? obj.learningLanguage,
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

  async update(
    id: string,
    userId: string,
    text?: string,
    removeImage?: boolean,
    image?: Express.Multer.File,
  ): Promise<CommunityPost> {
    const post = await this.findOne(id);
    if (post.userId !== userId) {
      throw new ForbiddenException('Cannot edit another user\'s post');
    }

    const oldImageUrl = post.imageUrl;
    const nextText = text === undefined ? post.text : text;
    if (!nextText && !image && (removeImage || !oldImageUrl))
      throw new BadRequestException('Post cannot be updated to be completely empty');

    const newImageUrl = image ? await this.images.store(image) : undefined;
    if (text !== undefined) post.text = text;
    if (newImageUrl || removeImage) post.imageUrl = newImageUrl;
    let saved: CommunityPost;
    try { saved = await post.save(); }
    catch (error) {
      await this.cleanupUnreferenced(newImageUrl, 'failed update');
      throw error;
    }
    // Commit the new reference before removing the old image. Cleanup failure
    // leaves an orphan, never a broken live post reference.
    if (newImageUrl || removeImage) await this.cleanupUnreferenced(oldImageUrl, 'replaced image');
    return saved;
  }

  async delete(id: string, userId: string): Promise<{ success: boolean }> {
    const post = await this.findOne(id);
    if (post.userId !== userId) {
      throw new ForbiddenException('Cannot delete another user\'s post');
    }

    // A failed DB deletion retains the referenced file. Clean the document
    // actually removed, including a replacement committed after the first read.
    const deleted = await this.communityPostModel.findByIdAndDelete(id).exec();
    if (deleted) await this.cleanupUnreferenced(deleted.imageUrl, 'deleted post');
    return { success: true };
  }

  async toggleLike(id: string, userId: string): Promise<{ likesCount: number; likedByMe: boolean }> {
    const post = await this.findOne(id);
    const index = post.likes.indexOf(userId);

    if (index === -1) {
      post.likes.push(userId);
    } else {
      post.likes.splice(index, 1);
    }

    post.likesCount = post.likes.length;
    await post.save();

    return {
      likesCount: post.likesCount,
      likedByMe: post.likes.includes(userId),
    };
  }
}
