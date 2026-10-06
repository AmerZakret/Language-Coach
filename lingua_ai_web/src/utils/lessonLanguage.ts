import type { TargetLanguage } from '../types/language';
import type { LessonLanguageCode } from '../types/lesson';

// Convert display selections only at the lesson boundary. Lesson data uses codes.
const codes: Record<TargetLanguage, LessonLanguageCode> = {
  English: 'en', German: 'de', Spanish: 'es', French: 'fr', Arabic: 'ar',
};

export const isLessonLanguageCode = (value: unknown): value is LessonLanguageCode =>
  typeof value === 'string' && Object.values(codes).includes(value as LessonLanguageCode);

export const lessonLanguageCode = (language: TargetLanguage | LessonLanguageCode): LessonLanguageCode =>
  isLessonLanguageCode(language) ? language : codes[language];
