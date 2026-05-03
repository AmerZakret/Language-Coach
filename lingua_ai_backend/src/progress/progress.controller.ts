import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { CompleteLessonDto } from './dto/complete-lesson.dto';

@Controller('progress')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Get(':userId')
  getUserProgress(@Param('userId') userId: string) {
    console.log('Fetching progress for user:', userId);
    return {
      userId,
      stats: {
        totalXp: 1250,
        streak: 5,
        completedLessonsCount: 8,
      },
      completedLessons: [
        { lessonId: '1', score: 100, completedAt: new Date().toISOString() },
        { lessonId: '2', score: 90, completedAt: new Date().toISOString() },
      ],
      level: 'Beginner',
    };
  }

  @Post(':userId/complete-lesson')
  completeLesson(
    @Param('userId') userId: string,
    @Body() completeLessonDto: CompleteLessonDto,
  ) {
    console.log(
      `User ${userId} completed lesson ${completeLessonDto.lessonId}`,
    );
    return {
      message: 'Lesson marked as completed (placeholder)',
      data: {
        userId,
        lessonId: completeLessonDto.lessonId,
        score: completeLessonDto.score,
        xpEarned: 50,
        newTotalXp: 1300,
      },
    };
  }
}
