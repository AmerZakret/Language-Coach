import 'package:shared_preferences/shared_preferences.dart';

class ProgressEpoch {
  static bool valid(dynamic value) =>
      value is int && value >= 0 && value <= 9007199254740991;
  static String key(String owner) => 'progress_epoch_$owner';
  static int? read(SharedPreferences prefs, String owner) {
    if (owner == 'local_guest') return null;
    final value = prefs.get(key(owner));
    return valid(value) ? value as int : null;
  }

  // Call under the existing owner queue lock and current-session guard.
  static Future<bool> acknowledge(
      SharedPreferences prefs, String owner, int epoch,
      {bool Function()? isCurrent}) async {
    bool currentSession() => isCurrent?.call() ?? true;
    if (!currentSession()) return false;
    if (owner == 'local_guest' || !valid(epoch)) return false;
    final current = read(prefs, owner);
    if (current != null && epoch < current) return false;
    if (current == epoch) return true;
    // An advanced epoch invalidates every language cache for this owner.
    for (final cacheKey in prefs
        .getKeys()
        .where((k) => k.startsWith('progress_${owner}_'))
        .toList()) {
      if (!currentSession()) return false;
      if (!await prefs.remove(cacheKey)) {
        throw StateError('Could not clear obsolete progress cache');
      }
    }
    if (!currentSession()) return false;
    if (!await prefs.setInt(key(owner), epoch)) {
      throw StateError('Could not persist progress epoch');
    }
    return true;
  }
}
