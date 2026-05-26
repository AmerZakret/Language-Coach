import { Body, Controller, Delete, Get, Post, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { AiCoachService } from './ai-coach.service';
import { ChatDto } from './dto/chat.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ai-coach')
@UseGuards(JwtAuthGuard)
export class AiCoachController {
  constructor(private readonly aiCoachService: AiCoachService) {}

  private validateUserAccess(userId: string, req: any) {
    if (req.user.id !== userId && req.user.email !== userId) {
      throw new ForbiddenException('Access denied: Cannot access another user\'s chat history');
    }
  }

  @Post('chat')
  async chat(@Body() chatDto: ChatDto, @Req() req: any) {
    this.validateUserAccess(chatDto.userId, req);
    return this.aiCoachService.sendMessage(
      chatDto.userId,
      chatDto.message,
      chatDto.language,
      chatDto.targetLanguage,
    );
  }

  @Get('history')
  async getHistory(
    @Query('userId') userId: string,
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    this.validateUserAccess(userId, req);
    return this.aiCoachService.getHistory(userId, targetLanguage);
  }

  @Delete('clear')
  async clearHistory(
    @Query('userId') userId: string,
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    this.validateUserAccess(userId, req);
    return this.aiCoachService.clearHistory(userId, targetLanguage);
  }
}
