import 'dart:async';
import 'package:lingua_ai/services/sync_storage.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  // Existing preference fault-injection/regression fixtures keep their adapter.
  // Native durability suites explicitly replace it with temporary file stores.
  SyncStorage.backend = PreferencesSyncStorage();
  SyncStorage.intents = PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
  await testMain();
}
