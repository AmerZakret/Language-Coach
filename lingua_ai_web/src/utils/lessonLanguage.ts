import type { LessonLanguageCode } from '../types/lesson';
import { targetLanguageCode, tryTargetLanguageCode } from './targetLanguage';

export const isLessonLanguageCode = (value: unknown): value is LessonLanguageCode =>
  typeof value === 'string' && tryTargetLanguageCode(value) === value;
export const lessonLanguageCode = targetLanguageCode;