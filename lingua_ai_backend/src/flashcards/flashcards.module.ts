import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlashcardsController } from './flashcards.controller';
import { FlashcardsService } from './flashcards.service';
import { Flashcard, FlashcardSchema } from './schemas/flashcard.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SrsCalculatorService } from './services/srs-calculator.service';
import { AiContextService } from './services/ai-context.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flashcard.name, schema: FlashcardSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [FlashcardsController],
  providers: [FlashcardsService, SrsCalculatorService, AiContextService],
  exports: [FlashcardsService],
})
export class FlashcardsModule {}
