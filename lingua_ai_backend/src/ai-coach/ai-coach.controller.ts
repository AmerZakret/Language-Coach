import { Body, Controller, Post } from '@nestjs/common';
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
    );
  }
}
