import type { TargetLanguage, TargetLanguageCode } from '../types/language';

export const TARGET_LANGUAGE_NAMES: Record<TargetLanguageCode, TargetLanguage> = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic',
};
const localizedNames: Record<TargetLanguageCode, string> = {
  en: 'İngilizce', de: 'Almanca', es: 'İspanyolca', fr: 'Fransızca', ar: 'Arapça',
};
export const tryTargetLanguageCode = (value: unknown): TargetLanguageCode | undefined => {
  if (typeof value !== 'string') return undefined;
  const input = value.trim().toLowerCase();
  return (Object.keys(TARGET_LANGUAGE_NAMES) as TargetLanguageCode[]).find(code =>
    [code, TARGET_LANGUAGE_NAMES[code].toLowerCase(), localizedNames[code].toLowerCase()].includes(input));
};
export const targetLanguageCode = (value: unknown): TargetLanguageCode => {
  const code = tryTargetLanguageCode(value);
  if (!code) throw new Error(`Unsupported target language: ${String(value)}`);
  return code;
};
export const targetLanguageName = (value: unknown): TargetLanguage => TARGET_LANGUAGE_NAMES[targetLanguageCode(value)];
export const targetLanguageTtsLocale = (value: unknown): string => ({
  en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA',
})[targetLanguageCode(value)];
