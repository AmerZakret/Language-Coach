import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class CompleteLessonDto {
  @IsNotEmpty()
  @IsString()
  lessonId: string;

  @IsInt()
  @Min(0)
  @Max(100)
  score: number;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  progressEpoch: number;
}
