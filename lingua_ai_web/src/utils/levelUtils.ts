export const getLevelFromXp = (xp: number): string => {
  if (xp >= 2200) return 'Advanced';
  if (xp >= 1400) return 'Upper-Intermediate';
  if (xp >= 900) return 'Intermediate';
  if (xp >= 500) return 'Pre-Intermediate';
  if (xp >= 200) return 'Elementary';
  return 'Beginner';
};

export const getProgressToNextLevel = (xp: number) => {
  const levels = [
    { name: 'Beginner', min: 0, max: 200 },
    { name: 'Elementary', min: 200, max: 500 },
    { name: 'Pre-Intermediate', min: 500, max: 900 },
    { name: 'Intermediate', min: 900, max: 1400 },
    { name: 'Upper-Intermediate', min: 1400, max: 2200 },
    { name: 'Advanced', min: 2200, max: 10000 },
  ];

  const currentLevel = levels.find(l => xp >= l.min && xp < l.max) || levels[levels.length - 1];
  const range = currentLevel.max - currentLevel.min;
  const progress = ((xp - currentLevel.min) / range) * 100;

  return {
    currentLevel: currentLevel.name,
    nextLevel: levels[levels.indexOf(currentLevel) + 1]?.name || 'Max',
    progress: Math.min(100, Math.max(0, progress)),
    xpRemaining: Math.max(0, currentLevel.max - xp),
  };
};
