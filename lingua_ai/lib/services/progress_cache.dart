import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

// Acknowledged cache only. Pending scores/rewards live in the durable queue.
class ProgressSnapshot {
  final int totalXp;
  final int streak;
  final Set<String> lessonIds;
  final List<double> activity;
  ProgressSnapshot(
      {this.totalXp = 0,
      this.streak = 0,
      Set<String>? lessonIds,
      List<double>? activity})
      : lessonIds = lessonIds ?? {},
        activity = activity ?? List.filled(7, 0.0);
  factory ProgressSnapshot.fromServer(Map<String, dynamic> response) =>
      ProgressSnapshot(
          totalXp: response['stats']?['totalXp'] as int? ?? 0,
          streak: response['stats']?['streak'] as int? ?? 0,
          lessonIds: {
            for (final row in response['completedLessons'] as List? ?? [])
              row['lessonId'].toString()
          });
  static String key(String owner, String language) =>
      'progress_${owner}_${language}_snapshot';
  static ProgressSnapshot read(
      SharedPreferences prefs, String owner, String language) {
    final prefix = 'progress_${owner}_${language}_';
    final raw = prefs.getString(key(owner, language));
    if (raw != null) {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      return ProgressSnapshot(
          totalXp: data['totalXp'] as int,
          streak: data['streak'] as int,
          lessonIds: Set<String>.from(data['lessonIds']),
          activity: (data['activity'] as List)
              .map((n) => (n as num).toDouble())
              .toList());
    }
    // Preserve attributable legacy caches locally; never infer missing scores.
    return ProgressSnapshot(
        totalXp: prefs.getInt('${prefix}totalXp') ?? 0,
        streak: prefs.getInt('${prefix}streak') ?? 0,
        lessonIds:
            (prefs.getStringList('${prefix}completedLessonIds') ?? []).toSet(),
        activity: prefs
            .getStringList('${prefix}weeklyActivity')
            ?.map((n) => double.tryParse(n) ?? 0.0)
            .toList());
  }

  Future<void> save(
      SharedPreferences prefs, String owner, String language) async {
    if (!await prefs.setString(
        key(owner, language),
        jsonEncode({
          'schemaVersion': 1,
          'totalXp': totalXp,
          'streak': streak,
          'lessonIds': lessonIds.toList(),
          'activity': activity,
        }))) {
      throw StateError('Could not persist acknowledged progress');
    }
  }

  ProgressSnapshot overlay(Iterable<Map<String, dynamic>> pending,
      {bool reset = false}) {
    final ids = reset ? <String>{} : {...lessonIds};
    var xp = reset ? 0 : totalXp;
    for (final payload in pending) {
      if (ids.add(payload['lessonId'].toString())) {
        xp += payload['xpReward'] as int? ?? 0;
      }
    }
    return ProgressSnapshot(
        totalXp: xp,
        streak: reset ? 0 : streak,
        lessonIds: ids,
        activity: reset ? null : activity);
  }

  static Future<void> resetOwner(SharedPreferences prefs, String owner) async {
    for (final key in prefs
        .getKeys()
        .where((k) => k.startsWith('progress_${owner}_'))
        .toList()) {
      if (!await prefs.remove(key)) {
        throw StateError('Could not clear progress cache');
      }
    }
  }
}
