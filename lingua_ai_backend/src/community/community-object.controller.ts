import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CommunityImageStorage,
  COMMUNITY_IMAGE_NAME,
  COMMUNITY_IMAGE_PREFIX,
} from './community-image.storage';

@Controller('uploads/community')
@UseGuards(JwtAuthGuard)
export class CommunityObjectController {
  constructor(private readonly images: CommunityImageStorage) {}
  @Get(':name')
  async read(@Param('name') name: string, @Res() res: Response) {
    if (!this.images.shared() || !COMMUNITY_IMAGE_NAME.test(name))
      throw new NotFoundException();
    const image = await this.images.readShared(COMMUNITY_IMAGE_PREFIX + name);
    res.set({
      'Content-Type': image.contentType,
      'Content-Length': String(image.buffer.length),
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(image.buffer);
  }
}
