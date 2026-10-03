import { Controller, Get, Post, Body, Param, Put, Delete, Query, UseGuards, Req, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FlashcardsService } from './flashcards.service';
import { CreateFlashcardDto } from './dto/create-flashcard.dto';
import { UpdateFlashcardDto } from './dto/update-flashcard.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('flashcards')
@UseGuards(JwtAuthGuard)
export class FlashcardsController {
  constructor(private readonly flashcardsService: FlashcardsService) {}

  @Post()
  async create(@Body() createFlashcardDto: CreateFlashcardDto, @Req() req: any) {
    const userId = req.user._id.toString();
    return this.flashcardsService.create(
      userId,
      createFlashcardDto.targetWord,
      createFlashcardDto.turkishTranslation,
      createFlashcardDto.targetLanguage,
      createFlashcardDto.nativeLanguage,
      createFlashcardDto.nativeTranslation,
      createFlashcardDto.exampleSentence,
      createFlashcardDto.note,
    );
  }

  @Get('due')
  async getDue(
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.flashcardsService.getDueCards(userId, targetLanguage);
  }

  @Get('all')
  async getAll(
    @Query('targetLanguage') targetLanguage: string,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.flashcardsService.getAll(userId, targetLanguage);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateFlashcardDto: UpdateFlashcardDto,
    @Req() req: any,
  ) {
    const userId = req.user._id.toString();
    return this.flashcardsService.update(
      id,
      updateFlashcardDto.targetWord,
      updateFlashcardDto.turkishTranslation,
      updateFlashcardDto.targetLanguage,
      updateFlashcardDto.nativeLanguage,
      updateFlashcardDto.nativeTranslation,
      updateFlashcardDto.exampleSentence,
      updateFlashcardDto.note,
      userId,
    );
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    const userId = req.user._id.toString();
    return this.flashcardsService.delete(id, userId);
  }

  @Put(':id/review')
  async review(
    @Param('id') id: string,
    @Body('score') score: number,
    @Req() req: any,
  ) {
    if (score === undefined || score < 0 || score > 5) {
      throw new BadRequestException('Review score must be between 0 and 5');
    }
    const userId = req.user._id.toString();
    return this.flashcardsService.review(id, score, userId);
  }
}
