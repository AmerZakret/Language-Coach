import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiCoachController } from './ai-coach.controller';
import { AiCoachService } from './ai-coach.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatMessage.name, schema: ChatMessageSchema },
    ]),
  ],
  controllers: [AiCoachController],
  providers: [AiCoachService],
})
export class AiCoachModule {}
