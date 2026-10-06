import { IsTargetLanguage } from '../../common/target-language';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFlashcardDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  targetWord: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  turkishTranslation: string;

  @IsNotEmpty()
  @IsString()
  @IsTargetLanguage()
  targetLanguage: string;

  @IsOptional()
  @IsString()
  nativeLanguage?: string;

  @IsOptional()
  @IsString()
  nativeTranslation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exampleSentence?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
