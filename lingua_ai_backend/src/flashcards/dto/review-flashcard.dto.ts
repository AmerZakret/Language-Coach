import { IsInt, Max, Min } from 'class-validator';

export class ReviewFlashcardDto {
  @IsInt()
  @Min(0)
  @Max(5)
  score: number;
}
