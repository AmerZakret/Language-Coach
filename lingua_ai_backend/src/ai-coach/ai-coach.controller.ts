import { Body, Controller, Post } from '@nestjs/common';
import { AiCoachService } from './ai-coach.service';
import { ChatDto } from './dto/chat.dto';

@Controller('ai-coach')
export class AiCoachController {
  constructor(private readonly aiCoachService: AiCoachService) {}

  @Post('chat')
  chat(@Body() chatDto: ChatDto) {
    console.log(`Chat message from ${chatDto.userId}: ${chatDto.message}`);
    return {
      userId: chatDto.userId,
      reply: `Hello! I am your AI Coach. I received your message: "${chatDto.message}". Real AI integration (OpenAI/Gemini) will be added to this endpoint soon!`,
      corrections: [
        {
          original: chatDto.message,
          correction: chatDto.message,
          explanation: 'This is a placeholder correction.',
        },
      ],
      turkishExplanation:
        'Merhaba! Ben AI Koçunuzum. Mesajınızı aldım. Gerçek yapay zeka entegrasyonu yakında eklenecek!',
    };
  }
}
