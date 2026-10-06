import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'progress_api_service.dart';
import 'flashcard_api_service.dart';
import 'auth_service.dart';

class OfflineQueueAction {
  final String id;
  final String type;
  final String ownerNamespace;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final int schemaVersion;
  OfflineQueueAction(
      {required this.id,
      required this.type,
      required this.ownerNamespace,
      required this.payload,
      required this.createdAt,
      this.schemaVersion = 1});
  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'ownerNamespace': ownerNamespace,
        'payload': payload,
        'createdAt': createdAt.toUtc().toIso8601String(),
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
        createdAt: DateTime.parse(json['createdAt'] as String));
  }
  OfflineQueueAction withPayload(Map<String, dynamic> value) =>
      OfflineQueueAction(
          id: id,
          type: type,
          ownerNamespace: ownerNamespace,
          payload: value,
          createdAt: createdAt,
          schemaVersion: schemaVersion);
}

class _QueueState {
  List<OfflineQueueAction> actions;
  final Map<String, String> tempIds;
  // A dispatched create cannot safely be compacted as unsent, including after
  // a restart or an ambiguous network failure. Later mutations stay dependent.
  final Set<String> startedCreates;
  _QueueState(this.actions, this.tempIds, this.startedCreates);
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
        _flashcardApi = FlashcardApiService();
  @visibleForTesting
  OfflineQueueService.forTesting(
      {required ProgressApiService progressApi,
      required FlashcardApiService flashcardApi})
      : _progressApi = progressApi,
        _flashcardApi = flashcardApi;
  final ProgressApiService _progressApi;
  final FlashcardApiService _flashcardApi;

  // Serialize record mutations across instances in this isolate, without
  // holding the write lock during HTTP. New appends can proceed during a drain.
  static final Map<String, Future<void>> _writeTails = {};
  static final Set<String> _drainingOwners = {};
  static int _actionSequence = 0;
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
        Set<String>.from(data['startedCreates']));
  }

  Future<bool> _write(String owner, _QueueState state,
      {SessionSnapshot? session}) async {
    if (state.actions.any((a) => a.ownerNamespace != owner)) {
      throw StateError('Cannot save actions in another owner queue');
    }
    final prefs = await SharedPreferences.getInstance();
    if (session != null && !session.isCurrent) return false;
    final encoded = json.encode({
      'schemaVersion': 2,
      'ownerNamespace': owner,
      'actions': state.actions.map((a) => a.toJson()).toList(),
      'tempIds': state.tempIds,
      'startedCreates': state.startedCreates.toList()
    });
    if (!await prefs.setString(_storageKey(owner), encoded)) {
      throw StateError('Could not persist the offline queue');
    }
    return true;
  }

  Future<List<OfflineQueueAction>> getQueue() {
    final owner = AuthService().localStorageNamespace;
    return _locked(owner, () async => (await _read(owner)).actions);
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
      Map<String, dynamic> payload) {
    final originalId = _cardId(payload);
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
    state.actions.add(OfflineQueueAction(
        id: 'action_${DateTime.now().microsecondsSinceEpoch}_${_actionSequence++}',
        type: type,
        ownerNamespace: owner,
        payload: _resolve(state, type, payload),
        createdAt: DateTime.now().toUtc()));
  }

  Future<void> pushAction(String type, Map<String, dynamic> payload,
          {required String ownerNamespace}) =>
      _locked(ownerNamespace, () async {
        final state = await _read(ownerNamespace);
        _append(state, ownerNamespace, type, payload);
        await _write(ownerNamespace, state);
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
            !state.actions.any((a) =>
                a.type == 'create-flashcard' && a.payload['tempId'] == id)) {
          return false;
        }
        _append(state, ownerNamespace, type, payload);
        await _write(ownerNamespace, state);
        return true;
      });

  Future<bool> processQueue(String userId) async {
    final auth = AuthService();
    final session = auth.captureSession();
    final owner = session.ownerNamespace;
    if (owner == 'local_guest' ||
        auth.token.trim().isEmpty ||
        userId != session.userId ||
        userId.isEmpty ||
        !_drainingOwners.add(owner)) {
      return false;
    }
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
          final current = found.single.withPayload(
              _resolve(state, found.single.type, found.single.payload));
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
        if (action == null) continue;
        String? serverId;
        try {
          final payload = action.payload;
          final cardId = _cardId(payload);
          if (_dependent(action.type) &&
              (cardId == null || cardId.startsWith('local_'))) {
            throw StateError('Pending card has no durable server mapping');
          }
          switch (action.type) {
            case 'complete-lesson':
              await _progressApi.completeLesson(
                  userId,
                  payload['lessonId'].toString(),
                  payload['score'] as int? ?? 100);
              break;
            case 'create-flashcard':
              final card = await _flashcardApi.createFlashcard(
                  userId,
                  payload['targetWord'].toString(),
                  payload['turkishTranslation'].toString(),
                  payload['targetLanguage'].toString(),
                  nativeLanguage: payload['nativeLanguage']?.toString(),
                  nativeTranslation: payload['nativeTranslation']?.toString(),
                  exampleSentence: payload['exampleSentence']?.toString(),
                  note: payload['note']?.toString());
              serverId = card.id;
              if (payload['tempId'] != null &&
                  (serverId.isEmpty || serverId.startsWith('local_'))) {
                throw StateError('Create response has no server card ID');
              }
              break;
            case 'update-flashcard':
              await _flashcardApi.updateFlashcard(
                  cardId!,
                  payload['targetWord'].toString(),
                  payload['turkishTranslation'].toString(),
                  targetLanguage: payload['targetLanguage']?.toString(),
                  exampleSentence: payload['exampleSentence']?.toString(),
                  note: payload['note']?.toString());
              break;
            case 'delete-flashcard':
              await _flashcardApi.deleteFlashcard(cardId!);
              break;
            case 'review-flashcard':
              await _flashcardApi.reviewCard(
                  cardId!, payload['score'] as int? ?? 4);
              break;
            default:
              throw StateError('Unsupported queued action');
          }
        } catch (e) {
          debugPrint('Offline action retained: $e');
          return false; // Preserve FIFO and all unacknowledged actions.
        }
        if (!session.isCurrent) return false;
        final acknowledged = await _locked(owner, () async {
          final state = await _read(owner);
          if (!session.isCurrent) return false;
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
      return session.isCurrent;
    } finally {
      _drainingOwners.remove(owner);
    }
  }
}
