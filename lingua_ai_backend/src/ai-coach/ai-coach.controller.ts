import { Body, Controller, Delete, Get, Post, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { AiCoachService } from './ai-coach.service';
import { ChatDto } from './dto/chat.dto';
import { WritingDto } from './dto/writing.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ai-coach')
@UseGuards(JwtAuthGuard)
export class AiCoachController {
  constructor(private readonly aiCoachService: AiCoachService) {}

  private validateUserAccess(userId: string, req: any) {
    const reqUserId = req.user._id ? req.user._id.toString() : req.user.id;
    if (reqUserId !== userId && req.user.email !== userId) {
      throw new ForbiddenException('Access denied: Cannot access another user\'s chat history');
    }
  }

  @Post('chat')
  async chat(@Body() chatDto: ChatDto, @Req() req: any) {
    const userId = req.user._id.toString();
    return this.aiCoachService.sendMessage(
      userId,
      chatDto.message,
      chatDto.language,
      chatDto.targetLanguage,
    );
  }

  @Post('writing-check')
  async writingCheck(@Body() writingDto: WritingDto, @Req() req: any) {
    const userId = req.user._id.toString();
    return this.aiCoachService.checkWriting(
      userId,
      writingDto.topic,
      writingDto.text,
      writingDto.language,
      writingDto.targetLanguage,
    );
  }

  @Get('history')
  async getHistory(
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.aiCoachService.getHistory(userId, targetLanguage);
  }

  @Delete('clear')
  async clearHistory(
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.aiCoachService.clearHistory(userId, targetLanguage);
  }

  @Delete('history')
  async deleteHistory(
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.aiCoachService.clearHistory(userId, targetLanguage);
  }
}

