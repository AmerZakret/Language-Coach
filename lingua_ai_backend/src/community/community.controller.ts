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
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunityService } from './community.service';
import { CreateCommunityPostDto } from './dto/create-community-post.dto';
import { UpdateCommunityPostDto } from './dto/update-community-post.dto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';

const uploadDir = './uploads/community';

export const communityMulterOptions = {
  storage: diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `post-${uniqueSuffix}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (req: any, file: any, cb: any) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Only images of type jpg, jpeg, png, or webp are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
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
    
    let imageUrl: string | undefined;
    if (file) {
      // Store relative path `/uploads/community/filename.png`
      imageUrl = `/uploads/community/${file.filename}`;
    }

    return this.communityService.create(
      userId,
      userName,
      dto.learningLanguage,
      dto.text,
      imageUrl,
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

    let imageUrl: string | undefined;
    if (file) {
      imageUrl = `/uploads/community/${file.filename}`;
    }

    const post = await this.communityService.update(
      id,
      userId,
      dto.text,
      removeImageVal,
      imageUrl,
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
