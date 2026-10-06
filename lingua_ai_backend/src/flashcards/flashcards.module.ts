import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { Flashcard, FlashcardSchema } from './schemas/flashcard.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SrsCalculatorService } from './services/srs-calculator.service';
import { AiContextService } from './services/ai-context.service';
import { FlashcardOperation, FlashcardOperationSchema } from './schemas/flashcard-operation.schema';
import { FlashcardIdempotencyService } from './flashcard-idempotency.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flashcard.name, schema: FlashcardSchema },
      { name: User.name, schema: UserSchema },
      { name: FlashcardOperation.name, schema: FlashcardOperationSchema },
    ]),
  ],
  controllers: [FlashcardsController],
  providers: [FlashcardsService, SrsCalculatorService, AiContextService, FlashcardIdempotencyService],
  exports: [FlashcardsService],
})
export class FlashcardsModule {}
