import { tryTargetLanguage } from '../common/target-language';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunityService } from './community.service';
import { CreateCommunityPostDto } from './dto/create-community-post.dto';
import { UpdateCommunityPostDto } from './dto/update-community-post.dto';
import { memoryStorage } from 'multer';
import { COMMUNITY_IMAGE_LIMIT } from './community-image.storage';

// Bounded in-memory staging: guards and DTO pipes run before any permanent
// image is created. Content validation and compensation belong to the service.
export const communityMulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: COMMUNITY_IMAGE_LIMIT, files: 1, fields: 10, fieldSize: 16 * 1024, parts: 11 },
};

@Controller('community/posts')
@UseGuards(JwtAuthGuard)
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get()
  async getFeed(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('language') language: string,
    @Req() req: any,
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const userId = req.user.id;
    return this.communityService.findAll(userId, pageNum, limitNum, language);
  }

  @Post()
  @UseInterceptors(FileInterceptor('image', communityMulterOptions))
  async createPost(
    @Body() dto: CreateCommunityPostDto,
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = req.user.id;
    const userName = req.user.name || 'Guest User';
    
    return this.communityService.create(
      userId,
      userName,
      dto.learningLanguage,
      dto.text,
      file,
    );
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('image', communityMulterOptions))
  async updatePost(
    @Param('id') id: string,
    @Body() dto: UpdateCommunityPostDto,
    @Req() req: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = req.user.id;
    
    // Parse removeImage as boolean
    const removeImageVal = dto.removeImage === 'true' || dto.removeImage === true;

    const post = await this.communityService.update(
      id,
      userId,
      dto.text,
      removeImageVal,
      file,
    );
    return { ...post.toObject(), learningLanguage: tryTargetLanguage(post.learningLanguage) ?? post.learningLanguage };
  }

  @Delete(':id')
  async deletePost(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id;
    return this.communityService.delete(id, userId);
  }

  @Post(':id/like')
  async toggleLike(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.id;
    return this.communityService.toggleLike(id, userId);
  }
}
