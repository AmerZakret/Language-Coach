import 'package:flutter_test/flutter_test.dart';
import 'package:lingua_ai/services/data_timeline.dart';
import 'dart:async';
import 'package:lingua_ai/services/sync_storage.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  // Existing preference fault-injection/regression fixtures keep their adapter.
  // Native durability suites explicitly replace it with temporary file stores.
  SyncStorage.backend = PreferencesSyncStorage();
  SyncStorage.intents = PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
  setUp(() {
    DataTimeline().resetForTesting(confirmed: '11111111-1111-4111-8111-111111111111');
    SyncStorage.direct = PreferencesSyncStorage(prefix: 'linguaai_direct_evidence_');
  });
  await testMain();
}
