import 'sync_storage_backend.dart';
import 'sync_storage_io.dart' if (dart.library.html) 'sync_storage_web.dart'
    as platform;
export 'sync_storage_backend.dart';

class SyncStorage {
  static SyncStorageBackend backend = platform.createSyncStorage();
}
