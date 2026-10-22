import { ChatBarrier, ChatBarrierSchema } from './schemas/chat-barrier.schema';
import { MutationReceiptModule } from '../common/mutation-receipt';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiCoachController } from './ai-coach.controller';
import { AiCoachService } from './ai-coach.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MutationReceiptModule,
    MongooseModule.forFeature([
      { name: ChatBarrier.name, schema: ChatBarrierSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AiCoachController],
  providers: [AiCoachService],
})
export class AiCoachModule {}
