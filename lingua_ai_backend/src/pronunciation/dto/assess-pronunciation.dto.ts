import { IsTargetLanguage } from '../../common/target-language';
import { IsNotEmpty, IsOptional, IsString, IsIn, MaxLength } from 'class-validator';

export class AssessPronunciationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  targetText: string;

  @IsString()
  @IsNotEmpty()
  @IsTargetLanguage()
  targetLanguage: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  nativeTranslation?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  nativeLanguage?: string;

  @IsString()
  @IsOptional()
  @IsIn(['flashcard', 'lesson', 'manual'])
  sourceType?: 'flashcard' | 'lesson' | 'manual';

}
