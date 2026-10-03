import type { Lesson } from '../types/lesson';

export function isLessonLocked(lesson: Lesson, allLessons: Lesson[], completedLessonIds: string[]): boolean {
  const level = lesson.level || "Beginner";
  if (level === "Beginner") return false;

  const getLessonsAtLevel = (lvl: string) => allLessons.filter((l) => (l.level || "Beginner") === lvl);
  
  const isLevelCompleted = (lvl: string) => {
    const lvlLessons = getLessonsAtLevel(lvl);
    if (lvlLessons.length === 0) return false;
    return lvlLessons.every((l) => completedLessonIds.includes(l.id));
  };

  if (level === "Elementary") {
    return !isLevelCompleted("Beginner");
  }
  if (level === "Pre-Intermediate") {
    return !isLevelCompleted("Beginner") || !isLevelCompleted("Elementary");
  }
  if (level === "Advanced") {
    return !isLevelCompleted("Beginner") || !isLevelCompleted("Elementary") || !isLevelCompleted("Pre-Intermediate");
  }
  
  return false;
}
