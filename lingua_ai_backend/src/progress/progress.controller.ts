import { ArgumentsHost, BadRequestException, Body, Catch, Controller, Delete, ExceptionFilter, Get, Headers, Param, Post, Query, UseFilters, UseGuards, Req } from '@nestjs/common';
import { ProgressService } from './progress.service';
import { CompleteLessonDto } from './dto/complete-lesson.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ResetProgressDto } from './dto/reset-progress.dto';

// Preserve global DTO validation while giving epoch failures the same codes
// as service validation. Other validation errors retain their normal response.
@Catch(BadRequestException)
class ProgressEpochValidationFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest();
    const response = exception.getResponse();
    const field = request.method === 'POST' ? 'progressEpoch'
      : request.method === 'DELETE' ? 'expectedEpoch' : undefined;
    if (field && typeof response === 'object' && 'message' in response
      && Array.isArray(response.message)
      && response.message.some((message: unknown) => typeof message === 'string' && message.startsWith(`${field} `))) {
      return http.getResponse().status(exception.getStatus()).json({
        ...response,
        code: request.body?.[field] === undefined ? 'MISSING_PROGRESS_EPOCH' : 'INVALID_PROGRESS_EPOCH',
      });
    }
    return http.getResponse().status(exception.getStatus()).json(response);
  }
}

@Controller('progress')
@UseGuards(JwtAuthGuard)
@UseFilters(new ProgressEpochValidationFilter())
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  // Keep the legacy URL parameter for route compatibility; JWT owns all access.

  @Get(':userId/reset-receipts/:operationId')
  async getResetReceipt(@Param('operationId') operationId: string,
    @Query('expectedEpoch') expectedEpoch: string, @Req() req: any) {
    if (expectedEpoch === undefined) throw new BadRequestException({
      code: 'MISSING_PROGRESS_EPOCH', message: 'A valid expected epoch is required',
    });
    const epoch = typeof expectedEpoch === 'string' && /^\d+$/.test(expectedEpoch) ? Number(expectedEpoch) : NaN;
    return this.progressService.getResetReceipt(req.user._id.toString(), epoch, operationId);
  }

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
      completeLessonDto.progressEpoch,
    );
  }

  @Delete(':userId')
  async resetProgress(@Param('userId') paramUserId: string, @Req() req: any,
    @Body() dto: ResetProgressDto, @Headers('x-idempotency-key') operationId: string) {
    const userId = req.user._id.toString();
    return this.progressService.resetProgress(userId, dto.expectedEpoch, operationId);
  }
}
