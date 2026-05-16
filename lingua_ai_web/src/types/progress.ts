export interface ProgressState {
  totalXp: number;
  streak: number;
  completedLessonIds: string[];
  weeklyActivity: number[];
}

export const DEFAULT_PROGRESS: ProgressState = {
  totalXp: 0,
  streak: 0,
  completedLessonIds: [],
  weeklyActivity: [0, 0, 0, 0, 0, 0, 0],
};
