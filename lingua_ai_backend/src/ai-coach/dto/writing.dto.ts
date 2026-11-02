import { IsTargetLanguage } from '../../common/target-language';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WritingDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  topic: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  text: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['en', 'tr'])
  language: string;

  @IsNotEmpty()
  @IsString()
  @IsTargetLanguage()
  targetLanguage: string;
}
