import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateFlashcardDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  word: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  translation: string;
}
