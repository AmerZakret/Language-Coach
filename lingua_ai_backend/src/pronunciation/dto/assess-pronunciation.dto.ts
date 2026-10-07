import { IsTargetLanguage } from '../../common/target-language';
import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class AssessPronunciationDto {
  @IsString()
  @IsNotEmpty()
  targetText: string;

  @IsString()
  @IsNotEmpty()
  @IsTargetLanguage()
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

}
