import { Injectable } from '@nestjs/common';

@Injectable()
export class SrsCalculatorService {
  /**
   * Implements the SM-2 inspired Spaced Repetition Algorithm
   * EF_new = EF_old + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
   */
  calculate(oldEf: number, oldInterval: number, score: number) {
    // 1. Calculate New Easiness Factor
    let newEf = oldEf + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02));
    
    // Floor EF at 1.3 to prevent stagnation
    if (newEf < 1.3) newEf = 1.3;

    // 2. Calculate New Interval
    let newInterval: number;
    if (score < 3) {
      // If score is low, reset interval but keep EF or reduce it
      newInterval = 1; 
    } else if (oldInterval === 0) {
      newInterval = 1;
    } else if (oldInterval === 1) {
      newInterval = 6;
    } else {
      newInterval = Math.ceil(oldInterval * newEf);
    }

    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

    return { newEf, newInterval, nextReviewDate };
  }
}
