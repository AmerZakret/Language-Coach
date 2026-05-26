class SrsCalculationResult {
  final double newEf;
  final int newInterval;
  final DateTime nextReviewDate;

  SrsCalculationResult({
    required this.newEf,
    required this.newInterval,
    required this.nextReviewDate,
  });
}

class SrsCalculator {
  static SrsCalculationResult calculate(double oldEf, int oldInterval, int score) {
    // 1. Calculate New Easiness Factor
    double newEf = oldEf + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02));
    
    // Floor EF at 1.3 to prevent stagnation
    if (newEf < 1.3) newEf = 1.3;

    // 2. Calculate New Interval
    int newInterval;
    if (score < 3) {
      // If score is low, reset interval
      newInterval = 1; 
    } else if (oldInterval == 0) {
      newInterval = 1;
    } else if (oldInterval == 1) {
      newInterval = 6;
    } else {
      newInterval = (oldInterval * newEf).ceil();
    }

    final nextReviewDate = DateTime.now().add(Duration(days: newInterval));

    return SrsCalculationResult(
      newEf: newEf,
      newInterval: newInterval,
      nextReviewDate: nextReviewDate,
    );
  }
}
