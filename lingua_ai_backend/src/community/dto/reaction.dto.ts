import { IsBoolean } from 'class-validator';
export class ReactionDto {
  @IsBoolean()
  liked: boolean;
}
