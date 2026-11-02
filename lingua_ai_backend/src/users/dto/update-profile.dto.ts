import { IsTargetLanguage } from '../../common/target-language';
import { IsNotEmpty, IsString, ValidateIf, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @IsTargetLanguage()
  targetLanguage?: string;
}
