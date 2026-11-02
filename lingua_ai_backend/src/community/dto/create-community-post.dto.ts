import { IsTargetLanguage } from '../../common/target-language';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCommunityPostDto {
  @IsString()
  @IsNotEmpty()
  @IsTargetLanguage()
  learningLanguage: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Text cannot exceed 1000 characters' })
  text?: string;
}
