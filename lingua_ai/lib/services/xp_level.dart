// Display-only mirror of backend common/xp-level.ts, checked by contract tests.
class XpLevels {
  static const thresholds = [0, 200, 500, 900, 1400, 2200];
  static const names = [
    'Beginner',
    'Elementary',
    'Pre-Intermediate',
    'Intermediate',
    'Upper-Intermediate',
    'Advanced'
  ];

  static int _band(int xp) {
    if (xp < 0 || xp > 9007199254740991) {
      throw ArgumentError.value(
          xp, 'xp', 'Expected nonnegative safe integer XP');
    }
    return thresholds.lastIndexWhere((value) => xp >= value);
  }

  static String levelFromXp(int xp) => names[_band(xp)];

  static Map<String, dynamic> info(int xp) {
    final band = _band(xp);
    final highest = band == thresholds.length - 1;
    final nextXp = highest ? thresholds.last : thresholds[band + 1];
    return {
      'level': names[band],
      'nextXp': nextXp,
      'progress':
          highest ? 1.0 : (xp - thresholds[band]) / (nextXp - thresholds[band])
    };
  }
}
