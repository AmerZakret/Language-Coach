import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/progress_epoch.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const owner = 'registered_507f1f77bcf86cd799439011';
  const other = 'registered_507f1f77bcf86cd799439012';
  late SharedPreferences prefs;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    await ProgressEpoch.acknowledge(prefs, owner, 1);
  });

  test(
      'malformed snapshots stay unavailable without throwing or replacing the original cache',
      () async {
    final valid = {
      'schemaVersion': 2,
      'progressEpoch': 1,
      'totalXp': 80,
      'streak': 0,
      'lessonIds': ['one'],
      'lessonScores': {'one': 73},
      'activity': [0.0]
    };
    for (final raw in [
      'broken JSON',
      'null',
      '[]',
      jsonEncode({...valid, 'totalXp': -1}),
      jsonEncode({...valid, 'totalXp': 0.5}),
      jsonEncode({
        ...valid,
        'lessonIds': [null]
      }),
      jsonEncode({
        ...valid,
        'lessonScores': {'one': 101}
      }),
      jsonEncode({
        ...valid,
        'activity': ['invalid']
      }),
      jsonEncode({...valid, 'schemaVersion': 99}),
      jsonEncode({...valid, 'progressEpoch': 0})
    ]) {
      await prefs.setString(ProgressSnapshot.key(owner, 'en'), raw);
      final snapshot = ProgressSnapshot.read(prefs, owner, 'en');
      expect(snapshot.available, false);
      await expectLater(snapshot.save(prefs, owner, 'en'), throwsStateError);
      expect(prefs.getString(ProgressSnapshot.key(owner, 'en')), raw);
    }
    await prefs.remove(ProgressSnapshot.key(owner, 'en'));
    await prefs.setString(ProgressSnapshot.key(owner, 'en'), jsonEncode(valid));
    expect(ProgressSnapshot.read(prefs, owner, 'en').lessonScores['one'], 73);
  });

  test(
      'acknowledged and pending duplicate count once, keep best score and do not double XP',
      () {
    final base = ProgressSnapshot(
        totalXp: 50,
        progressEpoch: 1,
        lessonIds: {'one'},
        lessonScores: {'one': 73});
    final overlay = base.overlay([
      {'lessonId': 'one', 'xpReward': 50, 'score': 91},
      {'lessonId': 'one', 'xpReward': 50, 'score': 20},
      {'lessonId': 'two', 'xpReward': 80, 'score': 42},
      {'lessonId': 'two', 'xpReward': 80, 'score': 40},
    ]);
    expect(overlay.lessonIds, {'one', 'two'});
    expect(overlay.totalXp, 130);
    expect(overlay.lessonScores, {'one': 91, 'two': 42});
    expect(base.lessonScores['one'], 73);
    expect(base.overlay([], reset: true).lessonIds, isEmpty);
    expect(base.overlay([], reset: true).totalXp, 0);
  });

  test(
      'owner reset removes all progress caches without touching another owner, epoch or feature data',
      () async {
    for (final language in ['en', 'English', 'de', 'German']) {
      await prefs.setString('progress_${owner}_${language}_snapshot', 'owner');
      await prefs.setString('progress_${other}_${language}_snapshot', 'other');
    }
    await prefs.setString('flashcards_${owner}_en', 'cards');
    await ProgressSnapshot.resetOwner(prefs, owner);
    expect(prefs.getKeys().where((key) => key.startsWith('progress_${owner}_')),
        isEmpty);
    expect(prefs.getString('progress_${other}_de_snapshot'), 'other');
    expect(prefs.getString('flashcards_${owner}_en'), 'cards');
    expect(ProgressEpoch.read(prefs, owner), 1);
  });
}
