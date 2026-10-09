import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'progress_epoch.dart';

// Acknowledged cache only. Pending scores/rewards live in the durable queue.
class ProgressSnapshot {
  final int totalXp;
  final int? progressEpoch;
  final int streak;
  final Set<String> lessonIds;
  final List<double> activity;
  final Map<String, int> lessonScores;
  final bool available;
  ProgressSnapshot(
      {this.totalXp = 0,
      this.progressEpoch,
      this.streak = 0,
      this.available = true,
      Map<String, int>? lessonScores,
      Set<String>? lessonIds,
      List<double>? activity})
      : lessonScores = lessonScores ?? {},
        lessonIds = lessonIds ?? {},
        activity = activity ?? List.filled(7, 0.0);
  static bool validScore(dynamic score) =>
      score is int && score >= 0 && score <= 100;
  factory ProgressSnapshot.fromServer(Map<String, dynamic> response) {
    final stats = response['stats'];
    final rows = response['completedLessons'];
    if (stats is! Map ||
        !ProgressEpoch.valid(stats['totalXp']) ||
        !ProgressEpoch.valid(stats['streak']) ||
        rows is! List ||
        !ProgressEpoch.valid(response['progressEpoch'])) {
      throw const FormatException('Invalid progress response');
    }
    final ids = <String>{};
    final scores = <String, int>{};
    for (final row in rows) {
      if (row is! Map ||
          row['lessonId'] is! String ||
          row['lessonId'].isEmpty ||
          (row['score'] != null && !validScore(row['score']))) {
        throw const FormatException('Invalid completion response');
      }
      final id = row['lessonId'] as String;
      ids.add(id);
      if (row['score'] != null) scores[id] = row['score'] as int;
    }
    return ProgressSnapshot(
        totalXp: stats['totalXp'] as int,
        progressEpoch: response['progressEpoch'] as int,
        streak: stats['streak'] as int,
        lessonIds: ids,
        lessonScores: scores);
  }
  static String key(String owner, String language) =>
      'progress_${owner}_${language}_snapshot';
  static ProgressSnapshot read(
      SharedPreferences prefs, String owner, String language) {
    try {
      return _read(prefs, owner, language);
    } catch (_) {
      return ProgressSnapshot(available: false);
    }
  }

  static ProgressSnapshot _read(
      SharedPreferences prefs, String owner, String language) {
    final prefix = 'progress_${owner}_${language}_';
    final raw = prefs.getString(key(owner, language));
    if (raw != null) {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final scores = data['lessonScores'] ?? <String, dynamic>{};
      if (![1, 2].contains(data['schemaVersion']) ||
          !ProgressEpoch.valid(data['totalXp']) ||
          !ProgressEpoch.valid(data['streak']) ||
          data['lessonIds'] is! List ||
          (data['lessonIds'] as List)
              .any((id) => id is! String || id.isEmpty) ||
          data['activity'] is! List ||
          (data['activity'] as List)
              .any((n) => n is! num || !n.isFinite || n < 0) ||
          scores is! Map ||
          scores.entries.any((e) =>
              e.key is! String ||
              !(data['lessonIds'] as List).contains(e.key) ||
              !validScore(e.value)) ||
          (data['progressEpoch'] != null &&
              !ProgressEpoch.valid(data['progressEpoch']))) {
        throw const FormatException('Invalid progress cache');
      }
      final epoch = ProgressEpoch.read(prefs, owner);
      if (epoch != null &&
          data['progressEpoch'] != null &&
          data['progressEpoch'] != epoch) {
        throw const FormatException('Obsolete progress cache');
      }
      return ProgressSnapshot(
          progressEpoch: data['progressEpoch'] as int?,
          lessonScores: Map<String, int>.from(scores),
          totalXp: data['totalXp'] as int,
          streak: data['streak'] as int,
          lessonIds: Set<String>.from(data['lessonIds']),
          activity: (data['activity'] as List)
              .map((n) => (n as num).toDouble())
              .toList());
    }
    // Preserve attributable legacy caches locally; never infer missing scores.
    if (!prefs.getKeys().any((key) => key.startsWith(prefix))) {
      return ProgressSnapshot(available: false);
    }
    final xp = prefs.getInt('${prefix}totalXp');
    final streak = prefs.getInt('${prefix}streak') ?? 0;
    final activity = prefs
        .getStringList('${prefix}weeklyActivity')
        ?.map(double.parse)
        .toList();
    if (!ProgressEpoch.valid(xp) ||
        !ProgressEpoch.valid(streak) ||
        activity?.any((n) => !n.isFinite || n < 0) == true) {
      throw const FormatException('Invalid legacy progress cache');
    }
    return ProgressSnapshot(
        totalXp: xp!,
        streak: prefs.getInt('${prefix}streak') ?? 0,
        lessonIds:
            (prefs.getStringList('${prefix}completedLessonIds') ?? []).toSet(),
        activity: activity);
  }

  bool get valid =>
      available &&
      ProgressEpoch.valid(totalXp) &&
      ProgressEpoch.valid(streak) &&
      (progressEpoch == null || ProgressEpoch.valid(progressEpoch)) &&
      activity.every((n) => n.isFinite && n >= 0) &&
      lessonIds.every((id) => id.isNotEmpty) &&
      lessonScores.entries.every(
          (entry) => lessonIds.contains(entry.key) && validScore(entry.value));

  Future<void> save(
      SharedPreferences prefs, String owner, String language) async {
    if (!valid) {
      throw StateError(
          'Unavailable or invalid progress cannot be acknowledged');
    }
    if (!await prefs.setString(
        key(owner, language),
        jsonEncode({
          'schemaVersion': 2,
          if (progressEpoch != null) 'progressEpoch': progressEpoch,
          'lessonScores': lessonScores,
          'totalXp': totalXp,
          'streak': streak,
          'lessonIds': lessonIds.toList(),
          'activity': activity,
        }))) {
      throw StateError('Could not persist acknowledged progress');
    }
  }

  ProgressSnapshot overlay(Iterable<Map<String, dynamic>> pending,
      {bool reset = false, bool local = false}) {
    final ids = reset ? <String>{} : {...lessonIds};
    final scores = reset ? <String, int>{} : {...lessonScores};
    var xp = reset ? 0 : totalXp;
    for (final payload in pending) {
      if (payload['lessonId'] is! String ||
          payload['lessonId'].isEmpty ||
          (payload['xpReward'] != null &&
              !ProgressEpoch.valid(payload['xpReward']))) {
        continue;
      }
      final id = payload['lessonId'].toString();
      if (!ids.contains(id)) {
        final nextXp = xp + (payload['xpReward'] as int? ?? 0);
        if (!ProgressEpoch.valid(nextXp)) continue;
        ids.add(id);
        xp = nextXp;
      }
      if (validScore(payload['score']) &&
          (payload['score'] as int) > (scores[id] ?? -1)) {
        scores[id] = payload['score'] as int;
      }
    }
    return ProgressSnapshot(
        totalXp: xp,
        available: local || available,
        progressEpoch: progressEpoch,
        lessonScores: scores,
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
