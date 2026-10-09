import { deriveLevel, validXp } from './xp-level';

describe('Canonical integer XP / level contract', () => {
  it.each([
    [0, 'Beginner'], [199, 'Beginner'], [200, 'Elementary'], [201, 'Elementary'],
    [499, 'Elementary'], [500, 'Pre-Intermediate'], [501, 'Pre-Intermediate'],
    [899, 'Pre-Intermediate'], [900, 'Intermediate'], [901, 'Intermediate'],
    [1399, 'Intermediate'], [1400, 'Upper-Intermediate'], [1401, 'Upper-Intermediate'],
    [2199, 'Upper-Intermediate'], [2200, 'Advanced'], [2201, 'Advanced'], [10000, 'Advanced'],
  ])('%s XP derives %s', (xp: number, level: string) => {
    expect(deriveLevel(xp)).toBe(level);
  });

  it.each([-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '50', null, undefined])(
    'rejects invalid XP %s', xp => {
      expect(() => validXp(xp)).toThrow('Progress XP is unavailable');
      expect(() => deriveLevel(xp as number)).toThrow('Progress XP is unavailable');
    },
  );
});
