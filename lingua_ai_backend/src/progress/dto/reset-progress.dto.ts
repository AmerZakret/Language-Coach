import { IsInt, Max, Min } from 'class-validator';

export class ResetProgressDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER - 1)
  expectedEpoch: number;
}
