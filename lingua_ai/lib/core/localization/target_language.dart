class TargetLanguage {
  static const names = {
    'en': 'English',
    'de': 'German',
    'es': 'Spanish',
    'fr': 'French',
    'ar': 'Arabic',
  };
  static const _localizedNames = {
    'en': 'İngilizce',
    'de': 'Almanca',
    'es': 'İspanyolca',
    'fr': 'Fransızca',
    'ar': 'Arapça',
  };
  static const _ttsLocales = {
    'en': 'en-US',
    'de': 'de-DE',
    'es': 'es-ES',
    'fr': 'fr-FR',
    'ar': 'ar-SA',
  };

  static String? tryCode(String? value) {
    final input = value?.trim().toLowerCase();
    for (final code in names.keys) {
      if (input == code ||
          input == names[code]!.toLowerCase() ||
          input == _localizedNames[code]!.toLowerCase()) {
        return code;
      }
    }
    return null;
  }

  static String code(String value) =>
      tryCode(value) ??
      (throw FormatException('Unsupported target language: $value'));
  static String name(String value) => names[code(value)]!;
  static String ttsLocale(String value) => _ttsLocales[code(value)]!;
}
