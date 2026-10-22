import { Controller, Post, UseInterceptors, UploadedFile, Body, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PronunciationService } from './pronunciation.service';
import { AssessPronunciationDto } from './dto/assess-pronunciation.dto';
import { AbusePolicy } from '../security/abuse-policy';
import { memoryStorage } from 'multer';

@Controller('pronunciation')
@UseGuards(JwtAuthGuard)
export class PronunciationController {
  constructor(private readonly pronunciationService: PronunciationService) {}

  @Post('assess')
  @AbusePolicy('provider')
  // Busboy emits partsLimit when the threshold is reached: leave one slot above
  // the five supported metadata fields plus one audio file.
  @UseInterceptors(FileInterceptor('audio', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 7, fieldSize: 4096 } }))
  async assessPronunciation(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AssessPronunciationDto,
  ) {
    return this.pronunciationService.assess(file, dto);
  }
}
