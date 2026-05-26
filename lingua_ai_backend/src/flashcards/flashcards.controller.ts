import { Controller, Get, Post, Body, Param, Put, Delete, Query, UseGuards, Req, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FlashcardsService } from './flashcards.service';
import { CreateFlashcardDto } from './dto/create-flashcard.dto';
import { UpdateFlashcardDto } from './dto/update-flashcard.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('flashcards')
@UseGuards(JwtAuthGuard)
export class FlashcardsController {
  constructor(private readonly flashcardsService: FlashcardsService) {}

  private validateUserAccess(userId: string, req: any) {
    if (req.user.id !== userId && req.user.email !== userId) {
      throw new ForbiddenException('Access denied: Cannot access another user\'s flashcards');
    }
  }

  @Post()
  async create(@Body() createFlashcardDto: CreateFlashcardDto, @Req() req: any) {
    this.validateUserAccess(createFlashcardDto.userId, req);
    return this.flashcardsService.create(
      createFlashcardDto.userId,
      createFlashcardDto.targetWord,
      createFlashcardDto.turkishTranslation,
      createFlashcardDto.exampleSentence,
      createFlashcardDto.note,
    );
  }

  @Get('due')
  async getDue(@Query('userId') userId: string, @Req() req: any) {
    this.validateUserAccess(userId, req);
    return this.flashcardsService.getDueCards(userId);
  }

  @Get('all')
  async getAll(@Query('userId') userId: string, @Req() req: any) {
    this.validateUserAccess(userId, req);
    return this.flashcardsService.getAll(userId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateFlashcardDto: UpdateFlashcardDto,
    @Req() req: any,
  ) {
    return this.flashcardsService.update(
      id,
      updateFlashcardDto.targetWord,
      updateFlashcardDto.turkishTranslation,
      updateFlashcardDto.exampleSentence,
      updateFlashcardDto.note,
      req.user.id,
    );
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.flashcardsService.delete(id, req.user.id);
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
    return this.flashcardsService.review(id, score, req.user.id);
  }
}
