import { targetLanguageCode, targetLanguageQuery, tryTargetLanguage } from '../common/target-language';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommunityPost, CommunityPostDocument } from './schemas/community-post.schema';
import { User } from '../users/schemas/user.schema';
import * as fs from 'fs';
import { join } from 'path';

@Injectable()
export class CommunityService {
  constructor(
    @InjectModel(CommunityPost.name)
    private readonly communityPostModel: Model<CommunityPostDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  private deleteImageFile(imageUrl: string) {
    if (!imageUrl) return;
    try {
      const urlParts = imageUrl.split('/uploads/');
      if (urlParts.length > 1) {
        // Resolve path: dist/community/../../uploads/<filename> -> root/uploads/<filename>
        const relativePath = join(__dirname, '..', '..', 'uploads', urlParts[1]);
        if (fs.existsSync(relativePath)) {
          fs.unlinkSync(relativePath);
        }
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    }
  }

  async create(
    userId: string,
    userName: string,
    learningLanguage: string,
    text?: string,
    imageUrl?: string,
  ): Promise<CommunityPost> {
    if (!text && !imageUrl) {
      throw new BadRequestException('Post must contain either text or an image');
    }

    const newPost = new this.communityPostModel({
      userId,
      userName,
      learningLanguage: targetLanguageCode(learningLanguage),
      text,
      imageUrl,
      likes: [],
      likesCount: 0,
    });

    return newPost.save();
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
    newImageUrl?: string,
  ): Promise<CommunityPost> {
    const post = await this.findOne(id);
    if (post.userId !== userId) {
      throw new ForbiddenException('Cannot edit another user\'s post');
    }

    if (text !== undefined) {
      post.text = text;
    }

    // Handle image removal or replacement
    if (removeImage || newImageUrl) {
      if (post.imageUrl) {
        this.deleteImageFile(post.imageUrl);
        post.imageUrl = undefined;
      }
    }

    if (newImageUrl) {
      post.imageUrl = newImageUrl;
    }

    if (!post.text && !post.imageUrl) {
      throw new BadRequestException('Post cannot be updated to be completely empty');
    }

    return post.save();
  }

  async delete(id: string, userId: string): Promise<{ success: boolean }> {
    const post = await this.findOne(id);
    if (post.userId !== userId) {
      throw new ForbiddenException('Cannot delete another user\'s post');
    }

    if (post.imageUrl) {
      this.deleteImageFile(post.imageUrl);
    }

    await this.communityPostModel.findByIdAndDelete(id).exec();
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
