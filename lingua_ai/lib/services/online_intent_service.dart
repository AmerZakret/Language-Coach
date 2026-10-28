import 'data_timeline.dart';
import 'dart:async';
import 'dart:convert';
import '../core/config/client_protocol.dart';
import 'api_response.dart';
import 'auth_service.dart';
import 'client_compatibility.dart';
import 'mutation_request.dart';
import 'sync_storage.dart';

class IntentRecoveryRequired implements Exception {
  const IntentRecoveryRequired();
  @override
  String toString() => 'A previous action needs confirmation or recovery. '
      'Saved work is preserved; refresh before trying a different action.';
}

// Only three online mutations use this bounded journal. This is not an offline
// outbox. Both collections use the existing two-slot/checksummed native backend.
class OnlineIntentService {
  static const capacity = 8;
  static const byteLimit = 8 * 1024 * 1024;
  // A clock dependency keeps retry tests independent of wall-clock sleeps.
  static int Function() clock = () => DateTime.now().millisecondsSinceEpoch;
  static final _tails = <String, Future<void>>{};
  static final _drains = <String, Future<void>>{};
  static bool isDispatching(String owner) => _drains.containsKey(owner);

  static Future<T> _lock<T>(
    Map<String, Future<void>> tails,
    String owner,
    Future<T> Function() work,
  ) async {
    final previous = tails[owner] ?? Future<void>.value();
    final release = Completer<void>();
    tails[owner] = release.future;
    await previous;
    try {
      return await work();
    } finally {
      release.complete();
      if (identical(tails[owner], release.future)) tails.remove(owner);
    }
  }

  static void _session(SessionSnapshot session) {
    if (!session.isDataCurrent) {
      throw StateError('Mutation session changed');
    }
    if (session.ownerNamespace == 'local_guest' ||
        AuthService().token.isEmpty) {
      throw const IntentRecoveryRequired();
    }
  }

  static void _validate(Map<String, dynamic> item, String owner) {
    if (item['dataTimelineId'] != null &&
        !DataTimeline.valid(item['dataTimelineId'])) {
      throw SyncStorageCorruption();
    }
    final payload = item['payload'];
    final kind = item['kind'];
    if (item['schemaVersion'] != 1 ||
        item['ownerNamespace'] != owner ||
        item['id'] is! String ||
        !RegExp(r'^[A-Za-z0-9._:-]{1,128}$').hasMatch(item['id']) ||
        item['protocol'] is! int ||
        item['protocol'] < 0 ||
        item['protocol'] > 999999 ||
        !['en', 'de', 'es', 'fr', 'ar'].contains(item['language']) ||
        !['preparing', 'pending', 'acknowledged', 'failed'].contains(item['state']) ||
        item['attempts'] is! int ||
        item['attempts'] < 0 ||
        item['attempts'] > 10000 ||
        item['nextAttemptAt'] is! int ||
        payload is! Map<String, dynamic>) {
      throw SyncStorageCorruption();
    }
    if (item['state'] == 'preparing' && kind != 'community-create') {
      throw SyncStorageCorruption();
    }
    final allowed = kind == 'ai-send'
        ? ['message', 'language', 'targetLanguage']
        : kind == 'ai-clear'
            ? ['targetLanguage']
            : kind == 'community-create'
                ? ['fields', 'files']
                : <String>[];
    if (allowed.isEmpty || payload.keys.any((key) => !allowed.contains(key))) {
      throw SyncStorageCorruption();
    }
    if (kind == 'ai-send' &&
        (payload['message'] is! String ||
            (payload['message'] as String).length > 20000 ||
            payload['language'] is! String)) {
      throw SyncStorageCorruption();
    }
    if (kind == 'community-create') {
      final fields = payload['fields'];
      final files = payload['files'];
      if (fields is! Map<String, dynamic> ||
          fields['learningLanguage'] != item['language'] ||
          fields.keys.any(
            (key) => !['learningLanguage', 'text'].contains(key),
          ) ||
          fields.values.any(
            (value) => value is! String || value.length > 20000,
          ) ||
          files is! List ||
          files.length > 1) {
        throw SyncStorageCorruption();
      }
      for (final file in files) {
        if (file is! Map ||
            file['field'] != 'image' ||
            file['filename'] is! String ||
            (file['filename'] as String).length > 255 ||
            ![
              'image/png',
              'image/jpeg',
              'image/webp',
            ].contains(file['contentType']) ||
            file['bytes'] is! String ||
            base64Decode(file['bytes']).length > 5 * 1024 * 1024) {
          throw SyncStorageCorruption();
        }
      }
    } else if (payload['targetLanguage'] != item['language']) {
      throw SyncStorageCorruption();
    }
  }

  static Future<Map<String, dynamic>> _read(String owner) async {
    final journal = await SyncStorage.intents.read(owner) ??
        {'schemaVersion': 1, 'ownerNamespace': owner, 'intents': <dynamic>[]};
    try {
      if (utf8.encode(jsonEncode(journal)).length > byteLimit ||
          journal['schemaVersion'] != 1 ||
          journal['ownerNamespace'] != owner ||
          journal['intents'] is! List ||
          journal['intents'].length > capacity) {
        throw const FormatException();
      }
      final ids = <String>{};
      for (final item in journal['intents']) {
        _validate(Map<String, dynamic>.from(item), owner);
        if (item['dataTimelineId'] == null ||
            (DataTimeline().lastConfirmedDataTimelineId != null &&
                !DataTimeline().matchesCache(item['dataTimelineId']))) {
          DataTimeline().noteEvidence();
        }
        if (!ids.add(item['id'])) throw const FormatException();
      }
      return journal;
    } catch (_) {
      throw SyncStorageCorruption();
    }
  }

  static Future<void> _write(String owner, Map<String, dynamic> journal) async {
    if (utf8.encode(jsonEncode(journal)).length > byteLimit) {
      throw const IntentRecoveryRequired();
    }
    await SyncStorage.intents.write(owner, journal);
  }

  static Future<List<Map<String, dynamic>>> list() async {
    final session = AuthService().captureSession();
    return _lock(_tails, session.ownerNamespace, () async {
      _session(session);
      return (await _read(session.ownerNamespace))['intents']
          .map<Map<String, dynamic>>((item) => Map<String, dynamic>.from(item))
          .toList();
    });
  }

  static Future<Map<String, dynamic>> prepare(
    String kind, String language, Map<String, dynamic> payload,
    {String? operationId, SessionSnapshot? expectedSession}) =>
      _prepare(kind, language, payload, operationId: operationId,
          expectedSession: expectedSession);

  // This initial durable record is committed before file/device/media awaits.
  // Its timeline and ID never change when preparation later completes.
  static Future<Map<String, dynamic>> beginCommunityCreate(
      String language, Map<String, String> fields,
      {String? operationId, String? selectedFilename,
      required SessionSnapshot expectedSession}) =>
      _prepare('community-create', language, {'fields': fields, 'files': <dynamic>[]},
          operationId: operationId, expectedSession: expectedSession,
          preparing: true, selectedFilename: selectedFilename);

  static Future<Map<String, dynamic>> finishCommunityPreparation(
      String id, Map<String, dynamic> payload,
      {required SessionSnapshot expectedSession}) async {
    final frozen = jsonDecode(jsonEncode(payload)) as Map<String, dynamic>;
    return _lock(_tails, expectedSession.ownerNamespace, () async {
      _session(expectedSession);
      final journal = await _read(expectedSession.ownerNamespace);
      _session(expectedSession);
      final item = (journal['intents'] as List).firstWhere((item) => item['id'] == id);
      if (item['kind'] != 'community-create' ||
          !DataTimeline().matchesCache(item['dataTimelineId'])) {
        throw const TimelineRecoveryRequired();
      }
      if (jsonEncode(item['payload']['fields']) != jsonEncode(frozen['fields'])) {
        throw const ApiException(ApiFailure.client,
            'Saved operation payload conflicts. Recovery is required.',
            409, false, 'IDEMPOTENCY_CONFLICT');
      }
      if (item['state'] != 'preparing') {
        if (jsonEncode(item['payload']) != jsonEncode(frozen)) {
          throw const ApiException(ApiFailure.client,
              'Saved operation payload conflicts. Recovery is required.',
              409, false, 'IDEMPOTENCY_CONFLICT');
        }
        return Map<String, dynamic>.from(item);
      }
      item['payload'] = frozen;
      item['state'] = 'pending';
      _validate(Map<String, dynamic>.from(item), expectedSession.ownerNamespace);
      _session(expectedSession);
      await _write(expectedSession.ownerNamespace, journal);
      return Map<String, dynamic>.from(item);
    });
  }

  static Future<Map<String, dynamic>> _prepare(
    String kind,
    String language,
    Map<String, dynamic> payload, {
    String? operationId, SessionSnapshot? expectedSession,
    bool preparing = false, String? selectedFilename,
  }) async {
    final session = expectedSession ?? AuthService().captureSession();
    _session(session);
    final timeline = DataTimeline().captureNewWork();
    final frozen = jsonDecode(jsonEncode(payload)) as Map<String, dynamic>;
    ClientCompatibility().ensureMutationAllowed();
    return _lock(_tails, session.ownerNamespace, () async {
      _session(session);
      final journal = await _read(session.ownerNamespace);
      _session(session);
      final items = journal['intents'] as List;
      if (operationId != null &&
          (journal['discardedIds'] as List? ?? []).contains(operationId)) {
        throw const IntentRecoveryRequired();
      }
      for (final item in items) {
        if (item['dataTimelineId'] != timeline) {
          if (operationId == item['id']) throw const TimelineRecoveryRequired();
          continue; // Explicit new user work gets a new ID; old evidence stays.
        }
        if (item['kind'] == kind && item['language'] == language) {
          if (preparing && kind == 'community-create') {
            final files = item['payload']['files'] as List;
            final originalFilename = item['selectedFilename'] ??
                (files.isEmpty ? null : files.first['filename']);
            if (jsonEncode(item['payload']['fields']) != jsonEncode(frozen['fields']) ||
                originalFilename != selectedFilename ||
                (operationId != null && operationId != item['id'])) {
              throw const ApiException(ApiFailure.client,
                  'Saved operation payload conflicts. Recovery is required.',
                  409, false, 'IDEMPOTENCY_CONFLICT');
            }
            return Map<String, dynamic>.from(item);
          }
          if (item['dataTimelineId'] != timeline) {
            throw const TimelineRecoveryRequired();
          }
          if (jsonEncode(item['payload']) != jsonEncode(frozen) ||
              (operationId != null && operationId != item['id'])) {
            throw const ApiException(
              ApiFailure.client,
              'Saved operation payload conflicts. Recovery is required.',
              409,
              false,
              'IDEMPOTENCY_CONFLICT',
            );
          }
          return Map<String, dynamic>.from(item);
        }
        if (kind.startsWith('ai-') &&
            (item['kind'] as String).startsWith('ai-') &&
            item['language'] == language) {
          throw const IntentRecoveryRequired();
        }
      }
      if (operationId != null &&
          items.any((item) => item['id'] == operationId)) {
        throw const IntentRecoveryRequired();
      }
      if (items.length >= capacity) throw const IntentRecoveryRequired();
      final intent = <String, dynamic>{
        'schemaVersion': 1,
        'id': operationId ?? newMutationId(),
        'ownerNamespace': session.ownerNamespace,
        'protocol': ClientProtocol.revision,
        'dataTimelineId': timeline,
        if (kind.startsWith('ai-'))
          'conversationId': (journal['conversations'] ??=
              <String, dynamic>{})['$timeline:$language'] ??= newMutationId(),
        'kind': kind,
        'language': language,
        'payload': frozen,
        'state': preparing ? 'preparing' : 'pending',
        if (preparing) 'selectedFilename': selectedFilename,
        'attempts': 0,
        'nextAttemptAt': 0,
      };
      _validate(intent, session.ownerNamespace);
      items.add(intent);
      await _write(session.ownerNamespace, journal);
      return intent;
    });
  }

  static Future<Map<String, dynamic>> run(
    String id,
    Future<Map<String, dynamic>> Function(Map<String, dynamic>, SessionSnapshot)
        dispatch,
    Future<void> Function(Map<String, dynamic>, Map<String, dynamic>) accept,
  ) async {
    await DataTimeline().ensureFresh();
    final session = AuthService().captureSession();
    final owner = session.ownerNamespace;
    return _lock(_drains, owner, () async {
      _session(session);
      var journal = await _lock(_tails, owner, () => _read(owner));
      final matches = (journal['intents'] as List).where(
        (item) => item['id'] == id,
      );
      if (matches.isEmpty) throw const IntentRecoveryRequired();
      var intent = Map<String, dynamic>.from(matches.first);
      DataTimeline().requireStored(intent['dataTimelineId']);
      if (intent['protocol'] != 2) throw const TimelineRecoveryRequired();
      final conversation = intent['conversationId'];
      if ((intent['kind'] as String).startsWith('ai-') &&
          (conversation is! String ||
              journal['conversations']
                      ?['${intent['dataTimelineId']}:${intent['language']}'] !=
                  conversation)) {
        throw const TimelineRecoveryRequired();
      }
      if (['timeline', 'provenance'].contains(intent['category']) || intent['state'] == 'preparing' || intent['state'] == 'failed' || intent['nextAttemptAt'] > clock()) {
        throw const IntentRecoveryRequired();
      }
      ClientCompatibility().ensureMutationAllowed();
      Future<void> change(void Function(Map<String, dynamic>) update, {bool requireFresh = true}) =>
          _lock(_tails, owner, () async {
            _session(session);
            if (requireFresh) {
              DataTimeline().requireStored(intent['dataTimelineId']);
            } else if (!DataTimeline().matchesCache(intent['dataTimelineId'])) {
              throw const TimelineRecoveryRequired();
            }
            journal = await _read(owner);
            _session(session);
            if (requireFresh) {
              DataTimeline().requireStored(intent['dataTimelineId']);
            } else if (!DataTimeline().matchesCache(intent['dataTimelineId'])) {
              throw const TimelineRecoveryRequired();
            }
            final current = (journal['intents'] as List).firstWhere(
              (item) => item['id'] == id,
            );
            update(current);
            await _write(owner, journal);
            intent = Map<String, dynamic>.from(current);
          });
      late Map<String, dynamic> result;
      if (intent['state'] == 'acknowledged') {
        result = Map<String, dynamic>.from(intent['result']);
      } else {
        await change(
          (item) =>
              item['attempts'] = (item['attempts'] as int).clamp(0, 9999) + 1,
        );
        try {
          result = await DataTimeline.replay(
            intent['dataTimelineId'],
            () => ClientProtocol.withRecordedRevision(
              intent['protocol'],
              () => dispatch(intent, session),
            ),
          );
          DataTimeline().requireStored(intent['dataTimelineId']);
          _session(session);
          await change((item) {
            item['state'] = 'acknowledged';
            item['result'] = result;
          });
        } catch (error) {
          if (session.isDataCurrent && (error is! TimelineRecoveryRequired || error.statusCode != null)) {
            final timelineError = error is TimelineRecoveryRequired ? error : null;
            final status = error is ApiException ? error.statusCode : timelineError?.statusCode;
            final paused = status == 401 || status == 426;
            final terminal = timelineError == null && status != null &&
                status >= 400 &&
                status < 500 &&
                ![401, 408, 425, 426, 429].contains(status);
            await change((item) {
              item['state'] = terminal ? 'failed' : 'pending';
              item['category'] = timelineError != null
                  ? timelineError.kind == TimelineFailure.maintenance ? 'maintenance'
                      : timelineError.kind == TimelineFailure.provenance ? 'provenance' : 'timeline'
                  : status == 409
                  ? 'conflict'
                  : paused
                      ? 'paused'
                      : terminal
                          ? 'validation'
                          : 'transient';
              final retryAfter =
                  error is ApiException ? error.retryAfterMs ?? 0 : timelineError?.retryAfterMs ?? 0;
              if (timelineError != null) item['code'] = timelineError.code;
              final attempts = (item['attempts'] as int).clamp(1, 7);
              item['nextAttemptAt'] = paused || timelineError != null && timelineError.kind != TimelineFailure.maintenance
                  ? 0
                  : clock() +
                      (5000 * (1 << (attempts - 1)))
                          .clamp(5000, 300000)
                          .clamp(retryAfter.clamp(0, 300000), 300000);
            }, requireFresh: false);
          }
          rethrow;
        }
      }
      _session(session);
      DataTimeline().requireStored(intent['dataTimelineId']);
      await accept(result, intent);
      await _lock(_tails, owner, () async {
        _session(session);
        journal = await _read(owner);
        _session(session);
        DataTimeline().requireStored(intent['dataTimelineId']);
        if (intent['kind'] == 'ai-clear') {
          (journal['conversations']
                  as Map)['${intent['dataTimelineId']}:${intent['language']}'] =
              newMutationId();
        }
        (journal['intents'] as List).removeWhere(
          (item) => item['id'] == id && item['state'] == 'acknowledged',
        );
        await _write(owner, journal);
      });
      return result;
    });
  }

  static Future<void> discardForReconciliation(String id) async {
    final session = AuthService().captureSession();
    await _lock(_tails, session.ownerNamespace, () async {
      _session(session);
      if (isDispatching(session.ownerNamespace)) {
        throw const IntentRecoveryRequired();
      }
      final journal = await _read(session.ownerNamespace);
      _session(session);
      final items = journal['intents'] as List;
      final matches = items.where((item) => item['id'] == id);
      if (matches.isEmpty) return;
      if (DataTimeline().canDispatch(matches.single['dataTimelineId'])) {
        throw const IntentRecoveryRequired();
      }
      // Keep a tombstone so a discarded destructive operation ID is never reused.
      final discarded = (journal['discardedIds'] ??= <dynamic>[]) as List;
      if (discarded.length >= 128) throw const IntentRecoveryRequired();
      discarded.add(id);
      items.removeWhere((item) => item['id'] == id);
      await _write(session.ownerNamespace, journal);
    });
  }
}
