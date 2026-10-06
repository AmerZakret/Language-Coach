import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class AssessPronunciationDto {
  @IsString()
  @IsNotEmpty()
  targetText: string;

  @IsString()
  @IsNotEmpty()
  targetLanguage: string;

  @IsString()
  @IsOptional()
  nativeTranslation?: string;

  @IsString()
  @IsOptional()
  nativeLanguage?: string;

  @IsString()
  @IsOptional()
  @IsIn(['flashcard', 'lesson', 'manual'])
  sourceType?: 'flashcard' | 'lesson' | 'manual';

  @IsString()
  @IsOptional()
  sourceId?: string;
}
