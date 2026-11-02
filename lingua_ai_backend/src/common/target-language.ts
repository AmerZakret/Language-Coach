import { BadRequestException } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';

export const TARGET_LANGUAGE_NAMES = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', ar: 'Arabic',
} as const;
export type TargetLanguageCode = keyof typeof TARGET_LANGUAGE_NAMES;
const localizedNames: Record<TargetLanguageCode, string> = {
  en: 'İngilizce', de: 'Almanca', es: 'İspanyolca', fr: 'Fransızca', ar: 'Arapça',
};

export function tryTargetLanguage(value: unknown): TargetLanguageCode | undefined {
  if (typeof value !== 'string') return undefined;
  const input = value.trim().toLowerCase();
  return (Object.keys(TARGET_LANGUAGE_NAMES) as TargetLanguageCode[]).find(code =>
    [code, TARGET_LANGUAGE_NAMES[code].toLowerCase(), localizedNames[code].toLowerCase()].includes(input));
}

export function targetLanguageCode(value: unknown): TargetLanguageCode {
  const code = tryTargetLanguage(value);
  if (!code) throw new BadRequestException('Unsupported target language');
  return code;
}

// Match known historical spellings without changing stored documents or indexes.
export function targetLanguageQuery(value: unknown): RegExp {
  const code = targetLanguageCode(value);
  return new RegExp(`^\\s*(${code}|${TARGET_LANGUAGE_NAMES[code]}|${localizedNames[code]})\\s*$`, 'i');
}

// Validation deliberately does not transform DTOs: existing operation receipts
// hash the original request, including legacy full-name language values.
export function IsTargetLanguage(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => registerDecorator({
    name: 'isTargetLanguage', target: object.constructor, propertyName: propertyName.toString(), options,
    validator: { validate: value => tryTargetLanguage(value) !== undefined,
      defaultMessage: () => 'Unsupported target language' },
  });
}

export function languageResponse<T>(record: T): T {
  if (!record) return record;
  const data = typeof (record as any).toObject === 'function' ? (record as any).toObject() : record;
  return { ...data, targetLanguage: tryTargetLanguage(data.targetLanguage) ?? data.targetLanguage };
}
