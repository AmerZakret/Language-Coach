import { Controller, Get, Post, Body, Param, Put, Query, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { FlashcardsService } from './flashcards.service';
import { CreateFlashcardDto } from './dto/create-flashcard.dto';
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
      createFlashcardDto.word,
      createFlashcardDto.translation,
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

  @Put(':id/review')
  async review(
    @Param('id') id: string,
    @Body('score') score: number,
    @Req() req: any,
  ) {
    return this.flashcardsService.review(id, score, req.user.id);
  }
}
