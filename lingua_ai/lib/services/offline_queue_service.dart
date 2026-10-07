import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'progress_api_service.dart';
import 'flashcard_api_service.dart';
import 'auth_service.dart';
import 'api_response.dart';
import 'progress_cache.dart';
import 'progress_epoch.dart';
import 'sync_retry_policy.dart';
import 'package:http/http.dart' as http;

class OfflineQueueAction {
  final String id;
  final String type;
  final String ownerNamespace;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final int schemaVersion;
  final int attemptCount;
  final DateTime? lastAttemptAt;
  final DateTime? nextAttemptAt;
  final String? lastErrorCategory;
  final DateTime? failedAt;
  OfflineQueueAction(
      {required this.id,
      required this.type,
      required this.ownerNamespace,
      required this.payload,
      required this.createdAt,
      this.schemaVersion = 1,
      this.attemptCount = 0,
      this.lastAttemptAt,
      this.nextAttemptAt,
      this.lastErrorCategory,
      this.failedAt});
  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'ownerNamespace': ownerNamespace,
        'payload': payload,
        'createdAt': createdAt.toUtc().toIso8601String(),
        if (attemptCount > 0) 'attemptCount': attemptCount,
        if (lastAttemptAt != null)
          'lastAttemptAt': lastAttemptAt!.toUtc().toIso8601String(),
        if (nextAttemptAt != null)
          'nextAttemptAt': nextAttemptAt!.toUtc().toIso8601String(),
        if (lastErrorCategory != null) 'lastErrorCategory': lastErrorCategory,
        if (failedAt != null) 'failedAt': failedAt!.toUtc().toIso8601String(),
        'schemaVersion': schemaVersion
      };
  factory OfflineQueueAction.fromJson(Map<String, dynamic> json) {
    if (json['schemaVersion'] != 1 ||
        json['ownerNamespace'] is! String ||
        (json['ownerNamespace'] as String).isEmpty) {
      throw const FormatException(
          'Queue action has no supported ownership schema');
    }
    return OfflineQueueAction(
        id: json['id'] as String,
        type: json['type'] as String,
        ownerNamespace: json['ownerNamespace'] as String,
        payload: Map<String, dynamic>.from(json['payload']),
        createdAt: DateTime.parse(json['createdAt'] as String),
        attemptCount: json['attemptCount'] as int? ?? 0,
        lastAttemptAt:
            DateTime.tryParse(json['lastAttemptAt'] as String? ?? ''),
        nextAttemptAt:
            DateTime.tryParse(json['nextAttemptAt'] as String? ?? ''),
        lastErrorCategory: json['lastErrorCategory'] as String?,
        failedAt: DateTime.tryParse(json['failedAt'] as String? ?? ''));
  }
  OfflineQueueAction withPayload(Map<String, dynamic> value) =>
      OfflineQueueAction(
          id: id,
          type: type,
          ownerNamespace: ownerNamespace,
          payload: value,
          createdAt: createdAt,
          schemaVersion: schemaVersion,
          attemptCount: attemptCount,
          lastAttemptAt: lastAttemptAt,
          nextAttemptAt: nextAttemptAt,
          lastErrorCategory: lastErrorCategory,
          failedAt: failedAt);
  OfflineQueueAction withRetry(
          {required int attempts,
          required DateTime attemptedAt,
          DateTime? nextAt,
          String? category,
          DateTime? failed}) =>
      OfflineQueueAction(
          id: id,
          type: type,
          ownerNamespace: ownerNamespace,
          payload: payload,
          createdAt: createdAt,
          schemaVersion: schemaVersion,
          attemptCount: attempts,
          lastAttemptAt: attemptedAt,
          nextAttemptAt: nextAt,
          lastErrorCategory: category,
          failedAt: failed);
}

class _QueueState {
  List<OfflineQueueAction> actions;
  final Map<String, String> tempIds;
  // A dispatched create cannot safely be compacted as unsent, including after
  // a restart or an ambiguous network failure. Later mutations stay dependent.
  final Set<String> startedCreates;
  String progressRevision;
  List<OfflineQueueAction> failedActions;
  _QueueState(this.actions, this.tempIds, this.startedCreates,
      [this.progressRevision = '', List<OfflineQueueAction>? failedActions])
      : failedActions = failedActions ?? [];
}

class OfflineQueueService {
  static const _legacyKey = 'linguaai_offline_queue';
  static const _quarantineKey = 'linguaai_offline_queue_legacy_unowned';
  String _storageKey(String owner) =>
      '${_legacyKey}_${Uri.encodeComponent(owner)}';
  static final OfflineQueueService _instance = OfflineQueueService._internal();
  factory OfflineQueueService() => _instance;
  OfflineQueueService._internal()
      : _progressApi = ProgressApiService(),
        _flashcardApi = FlashcardApiService(),
        _now = DateTime.now,
        _timeout = replayTimeout;
  @visibleForTesting
  OfflineQueueService.forTesting(
      {required ProgressApiService progressApi,
      required FlashcardApiService flashcardApi,
      DateTime Function()? now,
      Duration timeout = replayTimeout})
      : _progressApi = progressApi,
        _flashcardApi = flashcardApi,
        _now = now ?? DateTime.now,
        _timeout = timeout;
  final ProgressApiService _progressApi;
  final FlashcardApiService _flashcardApi;
  final DateTime Function() _now;
  final Duration _timeout;
  static final StreamController<void> _changes =
      StreamController<void>.broadcast();
  Stream<void> get changes => _changes.stream;

  // Serialize record mutations across instances in this isolate, without
  // holding the write lock during HTTP. New appends can proceed during a drain.
  static final Map<String, Future<void>> _writeTails = {};
  static final Set<String> _drainingOwners = {};
  static final Map<String, Completer<void>> _drainWaiters = {};
  static int _actionSequence = 0;
  String createOperationId() =>
      'action_${DateTime.now().microsecondsSinceEpoch}_${_actionSequence++}';
  Future<T> _locked<T>(String owner, Future<T> Function() work) async {
    final previous = _writeTails[owner] ?? Future<void>.value();
    final released = Completer<void>();
    _writeTails[owner] = released.future;
    await previous;
    try {
      return await work();
    } finally {
      released.complete();
      if (identical(_writeTails[owner], released.future)) {
        _writeTails.remove(owner);
      }
    }
  }

  Future<void> _quarantineLegacy(SharedPreferences prefs) async {
    final legacy = prefs.get(_legacyKey);
    if (legacy == null) return;
    // Ownerless data stays quarantined; never reconstruct its temp mappings.
    final snapshot = json.encode(legacy);
    final quarantine = prefs.getStringList(_quarantineKey) ?? [];
    if (!quarantine.contains(snapshot)) {
      quarantine.add(snapshot);
      if (!await prefs.setStringList(_quarantineKey, quarantine)) {
        throw StateError('Could not preserve the legacy queue');
      }
    }
    if (json.encode(prefs.get(_legacyKey)) == snapshot) {
      await prefs.remove(_legacyKey);
    }
  }

  Future<_QueueState> _read(String owner) async {
    final prefs = await SharedPreferences.getInstance();
    await _quarantineLegacy(prefs);
    final raw = prefs.get(_storageKey(owner));
    if (raw == null) return _QueueState([], {}, {});
    // Phase 4A lists migrate on the first mutation, without changing actions.
    if (raw is List<String>) {
      return _QueueState(
          raw.map((s) => OfflineQueueAction.fromJson(json.decode(s))).toList(),
          {},
          {});
    }
    final data = json.decode(raw as String) as Map<String, dynamic>;
    if (data['schemaVersion'] != 2 || data['ownerNamespace'] != owner) {
      throw const FormatException('Unsupported queue state');
    }
    return _QueueState(
        (data['actions'] as List)
            .map((a) =>
                OfflineQueueAction.fromJson(Map<String, dynamic>.from(a)))
            .toList(),
        Map<String, String>.from(data['tempIds']),
        Set<String>.from(data['startedCreates']),
        data['progressRevision'] as String? ?? '',
        (data['failedActions'] as List? ?? [])
            .map((a) =>
                OfflineQueueAction.fromJson(Map<String, dynamic>.from(a)))
            .toList());
  }

  Future<bool> _write(String owner, _QueueState state,
      {SessionSnapshot? session}) async {
    if ([...state.actions, ...state.failedActions]
        .any((a) => a.ownerNamespace != owner)) {
      throw StateError('Cannot save actions in another owner queue');
    }
    final prefs = await SharedPreferences.getInstance();
    if (session != null && !session.isCurrent) return false;
    final encoded = json.encode({
      'schemaVersion': 2,
      'ownerNamespace': owner,
      'actions': state.actions.map((a) => a.toJson()).toList(),
      'tempIds': state.tempIds,
      'startedCreates': state.startedCreates.toList(),
      'progressRevision': state.progressRevision,
      'failedActions': state.failedActions.map((a) => a.toJson()).toList()
    });
    if (!await prefs.setString(_storageKey(owner), encoded)) {
      throw StateError('Could not persist the offline queue');
    }
    _changes.add(null);
    return true;
  }

  Future<List<OfflineQueueAction>> getQueue() {
    final owner = AuthService().localStorageNamespace;
    return _locked(owner, () async => (await _read(owner)).actions);
  }

  Future<List<OfflineQueueAction>> getFailedActions() {
    final owner = AuthService().localStorageNamespace;
    return _locked(owner, () async => (await _read(owner)).failedActions);
  }

  Future<List<OfflineQueueAction>> getProgressActions() {
    final owner = AuthService().localStorageNamespace;
    return _locked(owner, () async {
      final state = await _read(owner);
      return [...state.actions, ...state.failedActions];
    });
  }

  String? _cardId(Map<String, dynamic> payload) =>
      (payload['cardId'] ?? payload['id'])?.toString();
  bool _dependent(String type) => [
        'update-flashcard',
        'delete-flashcard',
        'review-flashcard'
      ].contains(type);
  Map<String, dynamic> _resolve(
      _QueueState state, String type, Map<String, dynamic> payload) {
    final value = Map<String, dynamic>.from(payload);
    if (_dependent(type)) {
      final mapped = state.tempIds[_cardId(value)];
      if (mapped != null) {
        if (value.containsKey('cardId')) value['cardId'] = mapped;
        if (value.containsKey('id')) value['id'] = mapped;
      }
    }
    return value;
  }

  void _append(_QueueState state, String owner, String type,
      Map<String, dynamic> payload,
      {String? operationId, bool dispatched = false}) {
    if (type == 'reset-progress') {
      state.actions.removeWhere(
          (a) => a.type == 'complete-lesson' || a.type == 'reset-progress');
      state.failedActions.removeWhere(
          (a) => a.type == 'complete-lesson' || a.type == 'reset-progress');
    }
    final originalId = _cardId(payload);
    if (type == 'delete-flashcard' &&
        state.failedActions.any((a) =>
            a.type == 'create-flashcard' &&
            a.payload['tempId'] == originalId)) {
      state.failedActions.removeWhere((a) =>
          (a.type == 'create-flashcard' && a.payload['tempId'] == originalId) ||
          (_dependent(a.type) && _cardId(a.payload) == originalId));
      state.actions.removeWhere(
          (a) => _dependent(a.type) && _cardId(a.payload) == originalId);
      return;
    }
    final creates = state.actions
        .where((a) =>
            a.type == 'create-flashcard' && a.payload['tempId'] == originalId)
        .toList();
    if (_dependent(type) &&
        originalId != null &&
        creates.isNotEmpty &&
        !state.startedCreates.contains(creates.first.id)) {
      final create = creates.first;
      if (type == 'delete-flashcard') {
        state.actions.removeWhere((a) =>
            a.id == create.id ||
            (_dependent(a.type) && _cardId(a.payload) == originalId));
        return;
      }
      if (type == 'update-flashcard') {
        // Migrated Phase 4A queues may already contain separate edits. Fold
        // their fields in order before the latest edit so no earlier field is
        // lost when those actions are replaced by the compacted create.
        final fields = <String, dynamic>{};
        for (final action in state.actions) {
          if (action.type == 'update-flashcard' &&
              _cardId(action.payload) == originalId) {
            fields.addAll(action.payload);
          }
        }
        fields
          ..addAll(payload)
          ..remove('id')
          ..remove('cardId')
          ..remove('tempId')
          ..remove('userId');
        state.actions = state.actions
            .where((a) => !(a.type == 'update-flashcard' &&
                _cardId(a.payload) == originalId))
            .map((a) => a.id == create.id
                ? a.withPayload({...a.payload, ...fields})
                : a)
            .toList();
        return;
      }
    }
    final action = OfflineQueueAction(
        id: operationId ?? createOperationId(),
        type: type,
        ownerNamespace: owner,
        payload: _resolve(state, type, payload),
        createdAt: DateTime.now().toUtc());
    state.actions.add(action);
    if (type == 'complete-lesson' || type == 'reset-progress') {
      state.progressRevision = action.id;
    }
    if (type == 'create-flashcard' && dispatched) {
      state.startedCreates.add(action.id);
    }
  }

  Future<void> pushAction(String type, Map<String, dynamic> payload,
          {required String ownerNamespace,
          String? operationId,
          bool dispatched = false}) =>
      _locked(ownerNamespace, () async {
        final state = await _read(ownerNamespace);
        _append(state, ownerNamespace, type, payload,
            operationId: operationId, dispatched: dispatched);
        await _write(ownerNamespace, state);
        if (type == 'reset-progress') {
          await ProgressSnapshot.resetOwner(
              await SharedPreferences.getInstance(), ownerNamespace);
          final legacyOwner = payload['legacyOwnerNamespace'] as String?;
          if (legacyOwner != null) {
            await ProgressSnapshot.resetOwner(
                await SharedPreferences.getInstance(), legacyOwner);
          }
        }
      });

  Future<void> preparePendingProgress(String owner) => _locked(owner, () async {
        final state = await _read(owner);
        final prefs = await SharedPreferences.getInstance();
        var changed = false;
        state.actions = state.actions.map((action) {
          if (action.ownerNamespace != owner ||
              action.type != 'complete-lesson' ||
              action.payload['targetLanguage'] != null) {
            return action;
          }
          final matches = <Map<String, dynamic>>[];
          const names = {
            'en': 'English',
            'de': 'German',
            'es': 'Spanish',
            'fr': 'French',
            'ar': 'Arabic'
          };
          for (final entry in names.entries) {
            Map<String, dynamic>? lesson;
            for (final language in [entry.key, entry.value]) {
              try {
                final rows = jsonDecode(
                    prefs.getString('lessons_cache_$language') ?? '[]');
                if (rows is List) {
                  for (final row in rows) {
                    if (row is Map && row['id'] == action.payload['lessonId']) {
                      lesson = Map<String, dynamic>.from(row);
                    }
                  }
                }
              } catch (_) {/* Unusable catalog stays untouched. */}
            }
            if (lesson != null ||
                ProgressSnapshot.read(prefs, owner, entry.key)
                    .lessonIds
                    .contains(action.payload['lessonId'])) {
              matches.add({
                'targetLanguage': entry.key,
                if (lesson?['xpReward'] is int) 'xpReward': lesson!['xpReward']
              });
            }
          }
          if (matches.length != 1) return action;
          changed = true;
          return action.withPayload({...action.payload, ...matches.single});
        }).toList();
        if (changed) {
          state.progressRevision = 'migration_${createOperationId()}';
          await _write(owner, state);
        }
      });

  Future<int> epochForNewProgress(String owner, {bool forReset = false}) =>
      _locked(owner, () async {
        final state = await _read(owner);
        if (!forReset &&
            [...state.actions, ...state.failedActions]
                .any((a) => a.type == 'reset-progress')) {
          throw StateError(
              'Wait for progress reset acknowledgement before submitting new progress');
        }
        final epoch =
            ProgressEpoch.read(await SharedPreferences.getInstance(), owner);
        if (epoch == null) {
          throw StateError(
              'Connect to acknowledge server progress before submitting progress');
        }
        return epoch;
      });

  Future<String> progressRevision(String owner) =>
      _locked(owner, () async => (await _read(owner)).progressRevision);

  Future<bool> saveServerProgress(String owner, String language,
          String revision, ProgressSnapshot progress,
          {bool Function()? isCurrent}) =>
      _locked(owner, () async {
        if ((await _read(owner)).progressRevision != revision) return false;
        final prefs = await SharedPreferences.getInstance();
        if (!ProgressEpoch.valid(progress.progressEpoch) ||
            !await ProgressEpoch.acknowledge(
                prefs, owner, progress.progressEpoch!,
                isCurrent: isCurrent)) {
          return false;
        }
        if (isCurrent != null && !isCurrent()) return false;
        await progress.save(prefs, owner, language);
        return true;
      });

  Future<void> modifyLocalProgress(String owner, String language,
          ProgressSnapshot Function(ProgressSnapshot) update) =>
      _locked(owner, () async {
        final prefs = await SharedPreferences.getInstance();
        await update(ProgressSnapshot.read(prefs, owner, language))
            .save(prefs, owner, language);
      });

  /// A local ID is backend-pending only if its owner has a create or mapping.
  /// Permanently local cards must never become backend writes.
  Future<bool> mutatePendingCard(String type, Map<String, dynamic> payload,
          {required String ownerNamespace}) =>
      _locked(ownerNamespace, () async {
        if (ownerNamespace == 'local_guest') return false;
        final state = await _read(ownerNamespace);
        final id = _cardId(payload);
        if (!state.tempIds.containsKey(id) &&
            ![...state.actions, ...state.failedActions].any((a) =>
                a.type == 'create-flashcard' && a.payload['tempId'] == id)) {
          return false;
        }
        _append(state, ownerNamespace, type, payload);
        await _write(ownerNamespace, state);
        return true;
      });

  Future<bool> processQueue(String userId, {bool waitForActive = false}) async {
    final auth = AuthService();
    final session = auth.captureSession();
    final owner = session.ownerNamespace;
    if (waitForActive && _drainWaiters.containsKey(owner)) {
      await _drainWaiters[owner]!.future;
      if (!session.isCurrent) return false;
      return processQueue(userId, waitForActive: true);
    }
    if (owner == 'local_guest' ||
        auth.token.trim().isEmpty ||
        userId != session.userId ||
        userId.isEmpty ||
        !_drainingOwners.add(owner)) {
      return false;
    }
    final released = Completer<void>();
    _drainWaiters[owner] = released;
    var hadFailure = false;
    try {
      final batch =
          await _locked(owner, () async => (await _read(owner)).actions);
      if (!session.isCurrent || batch.any((a) => a.ownerNamespace != owner)) {
        return false;
      }
      for (final scheduled in batch) {
        if (!session.isCurrent) return false;
        final action = await _locked(owner, () async {
          final state = await _read(owner);
          if (!session.isCurrent) return null;
          final found =
              state.actions.where((a) => a.id == scheduled.id).toList();
          if (found.isEmpty) return null; // Cancelled before dispatch.
          if (found.single.nextAttemptAt?.isAfter(_now()) == true) return null;
          final replayPayload =
              _resolve(state, found.single.type, found.single.payload);
          // Freeze the new wire contract before first dispatch. Previously
          // attempted updates retain their old shape for existing receipts.
          if (found.single.type == 'update-flashcard' &&
              found.single.attemptCount == 0) {
            replayPayload['_mutationContract'] = 2;
          }
          if ((found.single.type == 'update-flashcard' ||
                  found.single.type == 'create-flashcard') &&
              found.single.attemptCount == 0) {
            replayPayload['_languageContract'] = 1;
          }
          final current = found.single.withPayload(replayPayload).withRetry(
              attempts: found.single.attemptCount + 1,
              attemptedAt: _now().toUtc());
          if (current.ownerNamespace != owner) {
            throw StateError('Queue owner mismatch');
          }
          if (current.type == 'create-flashcard' &&
              current.payload['tempId'] != null) {
            state.startedCreates.add(current.id);
          }
          state.actions = state.actions
              .map((a) => a.id == current.id ? current : a)
              .toList();
          if (!await _write(owner, state, session: session)) return null;
          return current;
        });
        if (!session.isCurrent) return false;
        if (action == null) {
          final remaining = await getQueue();
          if (remaining.any((a) => a.id == scheduled.id)) {
            return false; // Backoff holds FIFO.
          }
          continue;
        }
        String? serverId;
        Map<String, dynamic>? completion;
        Map<String, dynamic>? resetResult;
        final replayClient = http.Client();
        try {
          final payload = action.payload;
          final cardId = _cardId(payload);
          if (action.type == 'complete-lesson' &&
              (await getFailedActions())
                  .any((a) => a.type == 'reset-progress')) {
            throw const InvalidQueuedPayload();
          }
          if (_dependent(action.type) &&
              (cardId == null || cardId.startsWith('local_'))) {
            throw const InvalidQueuedPayload();
          }
          if (!session.isCurrent) return false;
          await withDeferredUnauthorizedInvalidation(() =>
              http.runWithClient(() async {
                switch (action.type) {
                  case 'reset-progress':
                    if (!ProgressEpoch.valid(payload['expectedEpoch'])) {
                      throw const InvalidQueuedPayload();
                    }
                    resetResult = await _progressApi.resetProgress(userId,
                        expectedEpoch: payload['expectedEpoch'] as int,
                        operationId: action.id);
                    if (resetResult?['progressEpoch'] !=
                        payload['expectedEpoch'] + 1) {
                      throw const InvalidQueuedPayload();
                    }
                    break;
                  case 'complete-lesson':
                    if (payload['score'] is! int ||
                        !ProgressEpoch.valid(payload['progressEpoch'])) {
                      throw const InvalidQueuedPayload();
                    }
                    completion = await _progressApi.completeLesson(userId,
                        payload['lessonId'].toString(), payload['score'] as int,
                        progressEpoch: payload['progressEpoch'] as int,
                        operationId: action.id);
                    if (completion?['data']?['progressEpoch'] !=
                        payload['progressEpoch']) {
                      throw const InvalidQueuedPayload();
                    }
                    break;
                  case 'create-flashcard':
                    final card = await _flashcardApi.createFlashcard(
                        payload['targetWord'].toString(),
                        payload['turkishTranslation'].toString(),
                        payload['targetLanguage'].toString(),
                        nativeLanguage: payload['nativeLanguage']?.toString(),
                        nativeTranslation:
                            payload['nativeTranslation']?.toString(),
                        exampleSentence: payload['exampleSentence']?.toString(),
                        note: payload['note']?.toString(),
                        operationId: action.id,
                        preserveLegacyLanguage:
                            payload['_languageContract'] != 1);
                    serverId = card.id;
                    if (payload['tempId'] != null &&
                        (serverId!.isEmpty || serverId!.startsWith('local_'))) {
                      throw StateError('Create response has no server card ID');
                    }
                    break;
                  case 'update-flashcard':
                    final legacy = payload['_mutationContract'] != 2;
                    String? optional(String field) {
                      final value = payload[field]?.toString();
                      return legacy && value == '' ? null : value;
                    }
                    await _flashcardApi.updateFlashcard(
                        cardId!,
                        payload['targetWord']?.toString(),
                        payload['turkishTranslation']?.toString(),
                        targetLanguage: payload['targetLanguage']?.toString(),
                        nativeLanguage: legacy
                            ? null
                            : payload['nativeLanguage']?.toString(),
                        nativeTranslation: legacy
                            ? null
                            : payload['nativeTranslation']?.toString(),
                        exampleSentence: optional('exampleSentence'),
                        note: optional('note'),
                        operationId: action.id,
                        preserveLegacyLanguage:
                            payload['_languageContract'] != 1);
                    break;
                  case 'delete-flashcard':
                    await _flashcardApi.deleteFlashcard(cardId!,
                        operationId: action.id);
                    break;
                  case 'review-flashcard':
                    await _flashcardApi.reviewCard(
                        cardId!, payload['score'] as int? ?? 4,
                        operationId: action.id);
                    break;
                  default:
                    throw const InvalidQueuedPayload();
                }
              }, () => replayClient)).timeout(_timeout);
        } catch (e) {
          if (!session.isCurrent) return false;
          final failure = SyncFailure.classify(e);
          await _locked(owner, () async {
            final state = await _read(owner);
            if (!session.isCurrent) return;
            final found = state.actions.where((a) => a.id == action.id);
            if (found.isEmpty) return; // Reset/cancellation won during HTTP.
            final current = found.single;
            final failed = current.withRetry(
                attempts: current.attemptCount,
                attemptedAt: current.lastAttemptAt!,
                category: failure.category,
                failed: failure.terminal ? _now().toUtc() : null,
                nextAt: failure.terminal
                    ? null
                    : _now().toUtc().add(retryDelay(current.attemptCount)));
            if (failure.terminal) {
              bool blocked(OfflineQueueAction a) =>
                  a.id == action.id ||
                  (action.type == 'create-flashcard' &&
                      action.payload['tempId'] != null &&
                      _dependent(a.type) &&
                      _cardId(a.payload) == action.payload['tempId']) ||
                  (action.type == 'reset-progress' &&
                      a.type == 'complete-lesson');
              state.failedActions.addAll(state.actions.where(blocked).map((a) =>
                  a.id == action.id
                      ? failed
                      : a.withRetry(
                          attempts: a.attemptCount,
                          attemptedAt: _now().toUtc(),
                          category: 'dependency',
                          failed: _now().toUtc())));
              state.actions.removeWhere(blocked);
              if (action.type == 'complete-lesson' ||
                  action.type == 'reset-progress') {
                state.progressRevision = 'failed_${action.id}';
              }
            } else {
              state.actions = state.actions
                  .map((a) => a.id == action.id ? failed : a)
                  .toList();
            }
            await _write(owner, state, session: session);
          });
          if (failure.category == 'authentication') {
            AuthService().invalidateSession(session);
          }
          hadFailure = true;
          if (!failure.terminal) {
            return false; // Preserve FIFO across transient failure.
          }
          continue;
        } finally {
          replayClient.close();
        }
        if (!session.isCurrent) return false;
        final acknowledged = await _locked(owner, () async {
          final state = await _read(owner);
          if (!session.isCurrent) return false;
          final prefs = await SharedPreferences.getInstance();
          if (!session.isCurrent) return false;
          if (state.actions.any((a) => a.id == action.id) &&
              action.type == 'complete-lesson') {
            final language = action.payload['targetLanguage'] as String?;
            final result = completion?['data'];
            if (language != null &&
                result?['newTotalXp'] is int &&
                await ProgressEpoch.acknowledge(
                    prefs, owner, result['progressEpoch'] as int,
                    isCurrent: () => session.isCurrent)) {
              if (!session.isCurrent) return false;
              final base = ProgressSnapshot.read(prefs, owner, language);
              await ProgressSnapshot(
                      totalXp: result['newTotalXp'] as int,
                      streak: base.streak,
                      lessonIds: {
                        ...base.lessonIds,
                        action.payload['lessonId'].toString()
                      },
                      activity: base.activity)
                  .save(prefs, owner, language);
            }
            state.progressRevision = 'ack_${action.id}';
          }
          if (action.type == 'reset-progress') {
            await ProgressEpoch.acknowledge(
                prefs, owner, resetResult!['progressEpoch'] as int,
                isCurrent: () => session.isCurrent);
            if (!session.isCurrent) return false;
            final legacyOwner =
                action.payload['legacyOwnerNamespace'] as String?;
            if (legacyOwner != null) {
              await ProgressSnapshot.resetOwner(prefs, legacyOwner);
            }
            state.progressRevision = 'ack_${action.id}';
          }
          final tempId = action.payload['tempId']?.toString();
          if (action.type == 'create-flashcard' && tempId != null) {
            state.tempIds[tempId] = serverId!;
          }
          // Commit mapping, all dependent rewrites, and removal together using
          // the current record, including appends made during the HTTP request.
          state.actions = state.actions
              .where((a) => a.id != action.id)
              .map((a) => a.withPayload(_resolve(state, a.type, a.payload)))
              .toList();
          state.startedCreates.remove(action.id);
          return _write(owner, state, session: session);
        });
        if (!acknowledged) return false;
      }
      return !hadFailure && session.isCurrent;
    } finally {
      _drainingOwners.remove(owner);
      _drainWaiters.remove(owner);
      released.complete();
    }
  }
}
