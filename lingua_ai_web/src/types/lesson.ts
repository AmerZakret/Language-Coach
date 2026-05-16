import type { TargetLanguage } from './language';

export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  type:
    | 'translation_tr_to_target'
    | 'translation_target_to_tr'
    | 'multiple_choice'
    | 'fill_blank'
    | 'grammar_correction'
    | 'meaning_match';
}

export interface Lesson {
  id: string;
  targetLanguage: TargetLanguage;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  level?: string;
  order?: number;
  duration: number | string;
  xpReward: number;
  questionCount?: number;
  questions?: Question[];
}
