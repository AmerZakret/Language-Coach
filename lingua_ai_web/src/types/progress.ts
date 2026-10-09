export interface ProgressState {
  progressEpoch?: number;
  available?: boolean;
  lessonScores?: Record<string, number>;
  totalXp: number;
  streak: number;
  completedLessonIds: string[];
  weeklyActivity: number[];
}

export const DEFAULT_PROGRESS: ProgressState = {
  available: false,
  lessonScores: {},
  totalXp: 0,
  streak: 0,
  completedLessonIds: [],
  weeklyActivity: [0, 0, 0, 0, 0, 0, 0],
};
