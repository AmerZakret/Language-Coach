import 'sync_storage_backend.dart';

SyncStorageBackend createSyncStorage() => PreferencesSyncStorage();
SyncStorageBackend createIntentStorage() =>
    PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
SyncStorageBackend createDirectStorage() =>
    PreferencesSyncStorage(prefix: 'linguaai_direct_evidence_');
