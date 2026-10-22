import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

abstract class SyncStorageBackend {
  bool get durable;
  Future<Map<String, dynamic>?> read(String owner);
  Future<void> write(String owner, Map<String, dynamic> value);
}

class SyncStorageCorruption implements Exception {
  final Map<String, dynamic>? previousValid;
  SyncStorageCorruption([this.previousValid]);
  @override
  String toString() =>
      'Sync storage needs recovery. Existing evidence and any previous valid snapshot are preserved.';
}

// Flutter web retains its existing persistence. Also an explicit regression
// test adapter; native production targets never choose this implementation.
class PreferencesSyncStorage implements SyncStorageBackend {
  String key(String owner) =>
      'linguaai_offline_queue_${Uri.encodeComponent(owner)}';
  @override
  bool get durable => false;
  @override
  Future<Map<String, dynamic>?> read(String owner) async {
    final raw = (await SharedPreferences.getInstance()).get(key(owner));
    if (raw == null || raw is List<String>) return null;
    return Map<String, dynamic>.from(jsonDecode(raw as String));
  }

  @override
  Future<void> write(String owner, Map<String, dynamic> value) async {
    if (!await (await SharedPreferences.getInstance())
        .setString(key(owner), jsonEncode(value))) {
      throw StateError('Could not persist the offline queue');
    }
  }
}
