import 'dart:async';
import 'dart:convert';
import 'auth_service.dart';
import 'data_timeline.dart';
import 'mutation_request.dart';
import 'sync_storage.dart';
import '../core/config/client_protocol.dart';

// Online-only writes have no background replay. Ambiguous outcomes retain an
// owner-scoped record in the same native two-slot store. Auth evidence excludes
// credentials and is never replayable. Explicit retries with a stable key must
// match the original timeline and payload.
class DirectMutationEvidence {
  static final _active = <String>{};
  static final _tails = <String, Future<void>>{};
  static Future<T> _lock<T>(String owner, Future<T> Function() work) async {
    final previous = _tails[owner] ?? Future<void>.value();
    final release = Completer<void>();
    _tails[owner] = release.future;
    await previous;
    try {
      return await work();
    } finally {
      release.complete();
      if (identical(_tails[owner], release.future)) _tails.remove(owner);
    }
  }

  static Future<Map<String, dynamic>> _read(String owner) async {
    final journal =
        await SyncStorage.direct.read(owner) ??
        {'schemaVersion': 1, 'ownerNamespace': owner, 'records': <dynamic>[]};
    if (journal['schemaVersion'] != 1 ||
        journal['ownerNamespace'] != owner ||
        journal['records'] is! List ||
        journal['records'].length > 32) {
      throw SyncStorageCorruption();
    }
    if (utf8.encode(jsonEncode(journal)).length > 8 * 1024 * 1024) {
      throw SyncStorageCorruption();
    }
    final ids = <String>{};
    for (final item in journal['records']) {
      if (item is! Map ||
          item['id'] is! String ||
          !ids.add(item['id']) ||
          item['ownerNamespace'] != owner ||
          item['protocol'] != 2 ||
          !DataTimeline.valid(item['dataTimelineId']) ||
          item['payload'] is! Map) {
        throw SyncStorageCorruption();
      }
      if (DataTimeline().lastConfirmedDataTimelineId != null &&
          !DataTimeline().matchesCache(item['dataTimelineId'])) {
        DataTimeline().noteEvidence();
      }
    }
    return journal;
  }

  static Future<List<Map<String, dynamic>>> list() {
    final owner = AuthService().localStorageNamespace;
    return _lock(
      owner,
      () async => (await _read(owner))['records']
          .map<Map<String, dynamic>>((item) => Map<String, dynamic>.from(item))
          .toList(),
    );
  }

  static Future<T> send<T>({
    required String method,
    required String path,
    required Map<String, dynamic> payload,
    required Future<T> Function() dispatch,
    required bool Function(T) acknowledged,
    String? operationId,
    Future<Map<String, dynamic>> Function()? preparePayload,
  }) async {
    final session = AuthService().captureSession();
    final owner = session.ownerNamespace;
    final timeline = DataTimeline();
    // Capture before the first await; discovery must never relabel this intent.
    final captured = timeline.captureNewWork();
    final id = operationId ?? newMutationId();
    final prepared = preparePayload == null
        ? const <String, dynamic>{}
        : await preparePayload();
    final identity = jsonDecode(
      jsonEncode({'method': method, 'path': path, ...payload, ...prepared}),
    );
    final record = await _lock(owner, () async {
      if (!session.isDataCurrent) throw const TimelineRecoveryRequired();
      final journal = await _read(owner);
      if ((journal['discardedIds'] as List? ?? []).contains(id)) {
        throw const TimelineRecoveryRequired();
      }
      final records = journal['records'] as List;
      final matches = records.where((item) => item['id'] == id);
      if (matches.isNotEmpty) {
        final original = Map<String, dynamic>.from(matches.single);
        if (jsonEncode(original['payload']) != jsonEncode(identity)) {
          throw const TimelineRecoveryRequired();
        }
        return original;
      }
      if (records.length >= 32) throw const TimelineRecoveryRequired();
      final item = {
        'id': id,
        'ownerNamespace': owner,
        'protocol': ClientProtocol.revision,
        'dataTimelineId': captured,
        'payload': identity,
      };
      records.add(item);
      if (utf8.encode(jsonEncode(journal)).length > 8 * 1024 * 1024) {
        throw const TimelineRecoveryRequired();
      }
      await SyncStorage.direct.write(owner, journal);
      return item;
    });
    final activeKey = '$owner:$id';
    if (!_active.add(activeKey)) throw const TimelineRecoveryRequired();
    try {
      await timeline.ensureFresh();
      if (!session.isDataCurrent) throw const TimelineRecoveryRequired();
      final result = await DataTimeline.replay(
        record['dataTimelineId'],
        dispatch,
      );
      timeline.requireStored(record['dataTimelineId']);
      if (acknowledged(result)) {
        if (!session.isDataCurrent) throw const TimelineRecoveryRequired();
        await _lock(owner, () async {
          final journal = await _read(owner);
          if (!session.isDataCurrent) throw const TimelineRecoveryRequired();
          (journal['records'] as List).removeWhere((item) => item['id'] == id);
          await SyncStorage.direct.write(owner, journal);
        });
      }
      return result;
    } finally {
      _active.remove(activeKey);
    }
  }

  static Future<void> discardForReconciliation(String id) async {
    final session = AuthService().captureSession();
    final owner = session.ownerNamespace;
    await _lock(owner, () async {
      if (!session.isCurrent || _active.contains('$owner:$id')) {
        throw const TimelineRecoveryRequired();
      }
      final journal = await _read(owner);
      final records = journal['records'] as List;
      final matches = records.where((item) => item['id'] == id);
      if (matches.isEmpty) return;
      if (DataTimeline().matchesCache(matches.single['dataTimelineId'])) {
        throw const TimelineRecoveryRequired();
      }
      final discarded = (journal['discardedIds'] ??= <dynamic>[]) as List;
      if (discarded.length >= 128) throw const TimelineRecoveryRequired();
      discarded.add(id);
      records.removeWhere((item) => item['id'] == id);
      await SyncStorage.direct.write(owner, journal);
    });
  }
}
