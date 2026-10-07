import { IsTargetLanguage } from '../../common/target-language';
import {
  IsIn,
  IsNotEmpty,
  ValidateIf,
  IsString,
  MaxLength,
} from 'class-validator';

export class ChatDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  message: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['en', 'tr'])
  language: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsTargetLanguage()
  targetLanguage?: string;
}
