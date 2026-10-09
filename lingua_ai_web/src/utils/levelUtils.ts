// Display-only mirror of backend common/xp-level.ts, checked by contract tests.
const levels = [
  { name: 'Beginner', min: 0 },
  { name: 'Elementary', min: 200 },
  { name: 'Pre-Intermediate', min: 500 },
  { name: 'Intermediate', min: 900 },
  { name: 'Upper-Intermediate', min: 1400 },
  { name: 'Advanced', min: 2200 },
] as const;

function bandForXp(xp: number) {
  if (!Number.isSafeInteger(xp) || xp < 0) {
    throw new RangeError('Expected nonnegative safe integer XP');
  }
  return levels.findLastIndex(level => xp >= level.min);
}

export const getLevelFromXp = (xp: number): string => levels[bandForXp(xp)].name;

export const getProgressToNextLevel = (xp: number) => {
  const index = bandForXp(xp);
  const current = levels[index];
  const next = levels[index + 1];
  return {
    currentLevel: current.name,
    nextLevel: next?.name || 'Max',
    progress: next ? ((xp - current.min) / (next.min - current.min)) * 100 : 100,
    xpRemaining: next ? next.min - xp : 0,
  };
};
