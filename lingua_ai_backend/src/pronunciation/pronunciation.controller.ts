import { Controller, Post, UseInterceptors, UploadedFile, Body, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PronunciationService } from './pronunciation.service';
import { AssessPronunciationDto } from './dto/assess-pronunciation.dto';
import { AbusePolicy } from '../security/abuse-policy';
import { memoryStorage } from 'multer';

// Only flat metadata fields are supported. Keep parser bounds explicit; the
// Nest options type does not yet expose Multer's new nesting/index limits.
const pronunciationMulterOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 5,
    parts: 7,
    fieldSize: 4096,
    fieldNameSize: 100,
    fieldNestingDepth: 0,
    fieldArrayIndexLimit: 0,
  },
};

@Controller('pronunciation')
@UseGuards(JwtAuthGuard)
export class PronunciationController {
  constructor(private readonly pronunciationService: PronunciationService) {}

  @Post('assess')
  @AbusePolicy('provider')
  @UseInterceptors(FileInterceptor('audio', pronunciationMulterOptions))
  async assessPronunciation(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AssessPronunciationDto,
  ) {
    return this.pronunciationService.assess(file, dto);
  }
}
