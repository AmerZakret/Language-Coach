import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { AiCoachService } from './ai-coach.service';
import { ChatDto } from './dto/chat.dto';

@Controller('ai-coach')
export class AiCoachController {
  constructor(private readonly aiCoachService: AiCoachService) {}

  @Post('chat')
  async chat(@Body() chatDto: ChatDto) {
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
  ) {
    return this.aiCoachService.getHistory(userId, targetLanguage);
  }

  @Delete('clear')
  async clearHistory(
    @Query('userId') userId: string,
    @Query('targetLanguage') targetLanguage: string,
  ) {
    return this.aiCoachService.clearHistory(userId, targetLanguage);
  }
}
