import { Controller, Post, UseInterceptors, UploadedFile, Body, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PronunciationService } from './pronunciation.service';
import { AssessPronunciationDto } from './dto/assess-pronunciation.dto';

@Controller('pronunciation')
@UseGuards(JwtAuthGuard)
export class PronunciationController {
  constructor(private readonly pronunciationService: PronunciationService) {}

  @Post('assess')
  @UseInterceptors(FileInterceptor('audio'))
  async assessPronunciation(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AssessPronunciationDto,
  ) {
    return this.pronunciationService.assess(file, dto);
  }
}
