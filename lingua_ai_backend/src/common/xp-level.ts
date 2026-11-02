import { InternalServerErrorException } from '@nestjs/common';

// XP is a nonnegative safe integer. Global and language levels share this contract.
export const XP_LEVELS = [
  { minXp: 0, level: 'Beginner' },
  { minXp: 200, level: 'Elementary' },
  { minXp: 500, level: 'Pre-Intermediate' },
  { minXp: 900, level: 'Intermediate' },
  { minXp: 1400, level: 'Upper-Intermediate' },
  { minXp: 2200, level: 'Advanced' },
] as const;

export function validXp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new InternalServerErrorException('Progress XP is unavailable. Please contact support.');
  }
  return value;
}

export function deriveLevel(xp: number): string {
  validXp(xp);
  return [...XP_LEVELS].reverse().find(band => xp >= band.minXp)!.level;
}
