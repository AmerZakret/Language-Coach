import { Type } from 'class-transformer';
import { IsOptional, IsString, IsInt, Min, MaxLength } from 'class-validator';

export class UpdateCommunityPostDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision: number;
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Text cannot exceed 1000 characters' })
  text?: string;

  @IsOptional()
  removeImage?: any;
}
