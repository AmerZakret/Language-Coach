import { Body, Controller, Delete, Get, Param, Post, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { CompleteLessonDto } from './dto/complete-lesson.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  private validateUserAccess(userId: string, req: any) {
    if (req.user.id !== userId && req.user.email !== userId) {
      throw new ForbiddenException('Access denied: Cannot access another user\'s progress');
    }
  }

  @Get(':userId')
  async getUserProgress(@Param('userId') userId: string, @Req() req: any) {
    this.validateUserAccess(userId, req);
    return this.progressService.getUserProgress(userId);
  }

  @Post(':userId/complete-lesson')
  async completeLesson(
    @Param('userId') userId: string,
    @Body() completeLessonDto: CompleteLessonDto,
    @Req() req: any,
  ) {
    this.validateUserAccess(userId, req);
    return this.progressService.completeLesson(
      userId,
      completeLessonDto.lessonId,
      completeLessonDto.score,
    );
  }

  @Delete(':userId')
  async resetProgress(@Param('userId') userId: string, @Req() req: any) {
    this.validateUserAccess(userId, req);
    return this.progressService.resetProgress(userId);
  }
}
