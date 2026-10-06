import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateFlashcardDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  targetWord?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  turkishTranslation?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNotEmpty()
  @IsString()
  targetLanguage?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  nativeLanguage?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  nativeTranslation?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  exampleSentence?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  note?: string;
}
