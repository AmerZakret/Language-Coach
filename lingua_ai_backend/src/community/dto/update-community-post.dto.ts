import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCommunityPostDto {
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Text cannot exceed 1000 characters' })
  text?: string;

  @IsOptional()
  removeImage?: any;
}
