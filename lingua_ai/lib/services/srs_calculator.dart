/// Model storing the calculated results of the SuperMemo-2 (SM-2) calculation.
class SrsCalculationResult {
  final double newEf;            // The recalculated Easiness Factor determining review frequency multiplier
  final int newInterval;         // The review interval length in days
  final DateTime nextReviewDate; // The exact calculated calendar date of the next due review

  SrsCalculationResult({
    required this.newEf,
    required this.newInterval,
    required this.nextReviewDate,
  });
}

/// Spaced Repetition System (SRS) Calculator:
/// Implements the classic SuperMemo-2 (SM-2) algorithm for scheduling flashcard reviews.
class SrsCalculator {
  
  /// Performs the SM-2 calculation based on the card's history and user review score:
  /// - [oldEf]: Current easiness factor of the flashcard (defaults to 2.5).
  /// - [oldInterval]: Current review interval in days.
  /// - [score]: User feedback score (0 to 5) indicating recall quality:
  ///   - 5: Perfect response.
  ///   - 4: Correct response after a hesitation.
  ///   - 3: Correct response recalled with serious difficulty.
  ///   - 2: Incorrect response; where the correct one seemed easy to recall.
  ///   - 1: Incorrect response; the correct one remembered.
  ///   - 0: Complete blackout.
  static SrsCalculationResult calculate(double oldEf, int oldInterval, int score) {
    // 1. Calculate New Easiness Factor (EF)
    // Formula shifts EF higher for scores >= 4 and lower for scores < 4
    double newEf = oldEf + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02));
    
    // Floor the Easiness Factor at 1.3.
    // Lower EFs would make card repetition intervals too short and cause card overload.
    if (newEf < 1.3) newEf = 1.3;

    // 2. Calculate New Review Interval in Days
    int newInterval;
    if (score < 3) {
      // If score is lower than 3, the card is forgotten. Reset interval back to 1 day.
      newInterval = 1; 
    } else if (oldInterval == 0) {
      // First review interval: 1 day
      newInterval = 1;
    } else if (oldInterval == 1) {
      // Second review interval: 6 days
      newInterval = 6;
    } else {
      // Subsequent review intervals: multiply previous interval by the new Easiness Factor
      newInterval = (oldInterval * newEf).ceil();
    }

    // Schedule next review date by adding calculated interval to current date
    final nextReviewDate = DateTime.now().add(Duration(days: newInterval));

    return SrsCalculationResult(
      newEf: newEf,
      newInterval: newInterval,
      nextReviewDate: nextReviewDate,
    );
  }
}

