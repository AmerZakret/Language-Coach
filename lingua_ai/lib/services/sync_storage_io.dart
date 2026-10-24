import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'sync_storage_backend.dart';

SyncStorageBackend createSyncStorage() => FileSyncStorage(() async {
      final support = await getApplicationSupportDirectory();
      return Directory('${support.path}${Platform.pathSeparator}sync-v1');
    });

SyncStorageBackend createIntentStorage() => FileSyncStorage(() async {
      final support = await getApplicationSupportDirectory();
      return Directory('${support.path}${Platform.pathSeparator}sync-v1'
          '${Platform.pathSeparator}online-intents');
    });

class FileSyncStorage implements SyncStorageBackend {
  final Future<Directory> Function() directory;
  // Fault injection at the flushed-but-not-promoted boundary, used only by tests.
  final Future<void> Function()? beforePromote;
  FileSyncStorage(this.directory, {this.beforePromote});
  @override
  bool get durable => true;
  static final Map<String, Future<void>> _tails = {};
  static int _sequence = 0;

  Future<T> _serialized<T>(
      String owner, Future<T> Function(Directory) work) async {
    if (!RegExp(
            r'^(registered_[a-f\d]{24}|guest_[a-f\d]{24}|local_guest|legacy_unowned)$',
            caseSensitive: false)
        .hasMatch(owner)) {
      throw StateError('Unsupported durable sync owner');
    }
    final root = (await directory()).absolute;
    final key = '${root.path}/$owner';
    final previous = _tails[key] ?? Future<void>.value();
    final released = Completer<void>();
    _tails[key] = released.future;
    await previous;
    try {
      return await work(root);
    } finally {
      released.complete();
      if (identical(_tails[key], released.future)) _tails.remove(key);
    }
  }

  File _slot(Directory root, String owner, int slot) =>
      File('${root.path}${Platform.pathSeparator}$owner.$slot.json');
  Future<List<Map<String, dynamic>>> _records(
      Directory root, String owner) async {
    final valid = <Map<String, dynamic>>[];
    var corrupt = false;
    for (var slot = 0; slot < 2; slot++) {
      final file = _slot(root, owner, slot);
      try {
        final record = jsonDecode(await file.readAsString());
        final body = record['body'];
        if (body is! Map<String, dynamic> ||
            body['schemaVersion'] != 1 ||
            body['ownerNamespace'] != owner ||
            body['generation'] is! int ||
            body['generation'] < 1 ||
            body['generation'] > 9007199254740991 ||
            body['generation'] % 2 != slot ||
            body['payload'] is! Map<String, dynamic> ||
            body['payload']['ownerNamespace'] != owner ||
            sha256.convert(utf8.encode(jsonEncode(body))).toString() !=
                record['sha256']) {
          throw const FormatException('Invalid sync record');
        }
        valid.add(body);
      } catch (error) {
        // Permission/I/O failures are not evidence that the file is corrupt.
        if (error is FileSystemException) {
          final code = error.osError?.errorCode;
          if (code == 2 || (Platform.isWindows && code == 3)) continue;
          rethrow;
        }
        corrupt = true;
      }
    }
    valid.sort(
        (a, b) => (a['generation'] as int).compareTo(b['generation'] as int));
    if (corrupt) {
      // A backup may omit recently appended work or a dispatched-create marker.
      // Expose it for recovery, but never automatically replay/overwrite it.
      throw SyncStorageCorruption(valid.isEmpty
          ? null
          : Map<String, dynamic>.from(valid.last['payload']));
    }
    return valid;
  }

  @override
  Future<Map<String, dynamic>?> read(String owner) =>
      _serialized(owner, (root) async {
        final records = await _records(root, owner);
        return records.isEmpty
            ? null
            : Map<String, dynamic>.from(records.last['payload']);
      });

  @override
  Future<void> write(String owner, Map<String, dynamic> value) =>
      _serialized(owner, (root) async {
        if (value['ownerNamespace'] != owner) {
          throw StateError('Sync owner mismatch');
        }
        final records = await _records(root, owner);
        final generation =
            records.isEmpty ? 1 : (records.last['generation'] as int) + 1;
        if (generation > 9007199254740991) {
          throw StateError('Sync generation exhausted');
        }
        final body = {
          'schemaVersion': 1,
          'ownerNamespace': owner,
          'generation': generation,
          'payload': value
        };
        final bytes = utf8.encode(jsonEncode({
          'body': body,
          'sha256': sha256.convert(utf8.encode(jsonEncode(body))).toString()
        }));
        await root.create(recursive: true);
        final pending = File(
            '${root.path}${Platform.pathSeparator}$owner.${DateTime.now().microsecondsSinceEpoch}.${_sequence++}.pending');
        final handle = await pending.open(mode: FileMode.writeOnly);
        try {
          await handle.writeFrom(bytes);
          await handle.flush();
        } finally {
          await handle.close();
        }
        await beforePromote?.call();
        // Replace only the older slot. The newest known-good slot is untouched.
        // Flush covers file contents; portable Dart provides no directory fsync.
        await pending.rename(_slot(root, owner, generation % 2).path);
      });
}
