import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WritingDto {
  @IsNotEmpty()
  @IsString()
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
  @IsIn([
    'en',
    'de',
    'es',
    'fr',
    'ar',
    'English',
    'German',
    'Spanish',
    'French',
    'Arabic',
  ])
  targetLanguage: string;
}
