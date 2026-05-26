import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFlashcardDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  targetWord: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  turkishTranslation: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  exampleSentence?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
