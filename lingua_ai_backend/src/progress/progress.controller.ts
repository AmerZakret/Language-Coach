import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { CompleteLessonDto } from './dto/complete-lesson.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  // Keep the legacy URL parameter for route compatibility; JWT owns all access.

  @Get(':userId')
  async getUserProgress(
    @Param('userId') paramUserId: string,
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.progressService.getUserProgress(userId, targetLanguage);
  }

  @Post(':userId/complete-lesson')
  async completeLesson(
    @Param('userId') paramUserId: string,
    @Body() completeLessonDto: CompleteLessonDto,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.progressService.completeLesson(
      userId,
      completeLessonDto.lessonId,
      completeLessonDto.score,
    );
  }

  @Delete(':userId')
  async resetProgress(@Param('userId') paramUserId: string, @Req() req: any) {
    const userId = req.user._id.toString();
    return this.progressService.resetProgress(userId);
  }
}
