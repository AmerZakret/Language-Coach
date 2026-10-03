import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCommunityPostDto {
  @IsString()
  @IsNotEmpty()
  learningLanguage: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Text cannot exceed 1000 characters' })
  text?: string;
}
