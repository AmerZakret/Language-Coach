import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChatDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  message: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['en', 'tr'])
  language: string;
}
