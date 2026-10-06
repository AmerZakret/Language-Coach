import { IsTargetLanguage } from '../../common/target-language';
import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class UpdateProfileDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @IsTargetLanguage()
  targetLanguage?: string;
}
