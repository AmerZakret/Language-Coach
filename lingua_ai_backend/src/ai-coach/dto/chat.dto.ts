import { IsNotEmpty, IsString } from 'class-validator';

export class ChatDto {
  @IsNotEmpty()
  @IsString()
  userId: string;

  @IsNotEmpty()
  @IsString()
  message: string;
}
