import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'progress_api_service.dart';
import 'flashcard_api_service.dart';
import 'auth_service.dart';

/// Model representing a single user action completed while offline.
/// Stores action IDs, operation types (e.g. 'complete-lesson', 'create-flashcard'), and the JSON payload.
class OfflineQueueAction {
  final String id;
  final String type;
  final String ownerNamespace;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  final int schemaVersion;

  OfflineQueueAction({
    required this.id,
    required this.type,
    required this.ownerNamespace,
    required this.payload,
    required this.createdAt,
    this.schemaVersion = 1,
  });

  // Convert model instance to a JSON Map for local storage serialization
  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'ownerNamespace': ownerNamespace,
        'payload': payload,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'schemaVersion': schemaVersion,
      };

  // Create model instance from deserialized JSON Map
  factory OfflineQueueAction.fromJson(Map<String, dynamic> json) {
    if (json['schemaVersion'] != 1 || json['ownerNamespace'] is! String ||
        (json['ownerNamespace'] as String).isEmpty) {
      throw const FormatException('Queue action has no supported ownership schema');
    }
    return OfflineQueueAction(
      id: json['id'] ?? '',
      type: json['type'] ?? '',
      ownerNamespace: json['ownerNamespace'] as String,
      payload: Map<String, dynamic>.from(json['payload'] ?? {}),
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}

/// Service managing offline mutation serialization, storage, and backend synchronization.
class OfflineQueueService {
  // Key name for local SharedPreferences list storage
  static const String _legacyKey = 'linguaai_offline_queue';
  static const String _quarantineKey = 'linguaai_offline_queue_legacy_unowned';

  String _storageKey(String owner) => '${_legacyKey}_${Uri.encodeComponent(owner)}';
  
  // Singleton pattern instantiation
  static final OfflineQueueService _instance = OfflineQueueService._internal();
  factory OfflineQueueService() => _instance;
  OfflineQueueService._internal()
      : _progressApi = ProgressApiService(),
        _flashcardApi = FlashcardApiService();

  @visibleForTesting
  OfflineQueueService.forTesting({
    required ProgressApiService progressApi,
    required FlashcardApiService flashcardApi,
  }) : _progressApi = progressApi, _flashcardApi = flashcardApi;

  // API service connectors to post actions to NestJS backend endpoints
  final ProgressApiService _progressApi;
  final FlashcardApiService _flashcardApi;
  
  // Concurrency lock preventing multiple sync threads from draining the queue simultaneously
  bool _isProcessing = false;

  /// Retrieves the list of pending offline actions from local SharedPreferences.
  Future<List<OfflineQueueAction>> getQueue() async {
    return _getQueue(AuthService().localStorageNamespace);
  }

  Future<void> _quarantineLegacy(SharedPreferences prefs) async {
    final legacy = prefs.get(_legacyKey);
    if (legacy == null) return;
    // Preserve complete raw snapshots, including malformed data. Never infer an
    // owner from a legacy payload or assign it to the currently active account.
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

  Future<List<OfflineQueueAction>> _getQueue(String owner) async {
    final prefs = await SharedPreferences.getInstance();
    await _quarantineLegacy(prefs);
    final data = prefs.getStringList(_storageKey(owner));
    if (data == null) return [];
    return data
          .map((item) => OfflineQueueAction.fromJson(json.decode(item)))
          .toList();
  }

  /// Persists the list of offline actions back to SharedPreferences.
  Future<bool> _saveQueue(String owner, List<OfflineQueueAction> queue, {
    bool Function()? sessionMatches,
  }) async {
    if (queue.any((action) => action.ownerNamespace != owner)) {
      throw StateError('Cannot save actions in another owner queue');
    }
    final prefs = await SharedPreferences.getInstance();
    if (sessionMatches != null && !sessionMatches()) return false;
    final data = queue.map((action) => json.encode(action.toJson())).toList();
    return prefs.setStringList(_storageKey(owner), data);
  }

  /// Appends a new user action to the queue when a network write error occurs.
  Future<void> pushAction(String type, Map<String, dynamic> payload, {
    required String ownerNamespace,
  }) async {
    final createdAt = DateTime.now().toUtc();
    final queue = await _getQueue(ownerNamespace);
    final action = OfflineQueueAction(
      // Generate a unique action ID based on timestamp and data hash
      id: 'action_${DateTime.now().millisecondsSinceEpoch}_${payload.hashCode}',
      type: type,
      ownerNamespace: ownerNamespace,
      payload: Map<String, dynamic>.from(payload),
      createdAt: createdAt,
    );
    queue.add(action);
    await _saveQueue(ownerNamespace, queue);
    debugPrint('Pushed action to offline queue: $type');
  }

  /// Synchronizes all queued local operations with the backend when connection is restored.
  /// Iterates through queued items chronologically and maps temporary IDs to final database IDs.
  Future<bool> processQueue(String userId) async {
    final auth = AuthService();
    final owner = auth.localStorageNamespace;
    final sessionVersion = auth.sessionVersion;
    final sessionToken = auth.token;
    final sessionUserId = auth.currentUserId;
    bool sessionMatches() => auth.localStorageNamespace == owner &&
        auth.sessionVersion == sessionVersion && auth.token == sessionToken &&
        auth.currentUserId == sessionUserId;
    // The caller's ID cannot select a different owner's queue. Local-only data
    // has no backend credentials and must never become a backend user's queue.
    if (owner == 'local_guest' || sessionToken.trim().isEmpty ||
        sessionUserId.isEmpty || userId != sessionUserId) {
      return false;
    }
    // Return early if synchronization is already running to avoid network duplication
    if (_isProcessing) {
      debugPrint('OfflineQueueService: processQueue is already running, skipping duplicate call.');
      return false;
    }
    _isProcessing = true;
    try {
      final queue = await _getQueue(owner);
      if (!sessionMatches() || queue.any((action) => action.ownerNamespace != owner)) {
        return false;
      }
      if (queue.isEmpty) return true;

      debugPrint('Processing ${queue.length} offline actions for user $userId...');
      
      // Maps client-generated temporary IDs (e.g. 'local_171') to official server ObjectIds
      final idMap = <String, String>{};
      final List<OfflineQueueAction> remaining = [];
      bool success = true;

      for (var action in queue) {
        if (!sessionMatches() || action.ownerNamespace != owner) return false;
        try {
          final payload = Map<String, dynamic>.from(action.payload);

          // ID Mapping Stage: If this action references a card created offline,
          // overwrite the cardId parameter with the server-generated ObjectId resolved during sync.
          if (action.type == 'update-flashcard' ||
              action.type == 'delete-flashcard' ||
              action.type == 'review-flashcard') {
            final cardId = payload['cardId'] ?? payload['id'];
            if (cardId != null && idMap.containsKey(cardId)) {
              final newId = idMap[cardId]!;
              if (payload.containsKey('cardId')) payload['cardId'] = newId;
              if (payload.containsKey('id')) payload['id'] = newId;
            }
          }

          // Route actions to their respective API request endpoints
          switch (action.type) {
            case 'complete-lesson':
              await _progressApi.completeLesson(
                userId,
                payload['lessonId'].toString(),
                payload['score'] as int? ?? 100,
              );
              break;

            case 'create-flashcard':
              final newCard = await _flashcardApi.createFlashcard(
                userId,
                payload['targetWord'].toString(),
                payload['turkishTranslation'].toString(),
                payload['targetLanguage'].toString(),
                exampleSentence: payload['exampleSentence']?.toString(),
                note: payload['note']?.toString(),
              );
              // Save mapping of temporary ID to official backend ObjectId
              if (payload.containsKey('tempId') && newCard.id.isNotEmpty) {
                idMap[payload['tempId'].toString()] = newCard.id;
              }
              break;

            case 'update-flashcard':
              final cardId = payload['cardId'] ?? payload['id'];
              await _flashcardApi.updateFlashcard(
                cardId.toString(),
                payload['targetWord'].toString(),
                payload['turkishTranslation'].toString(),
                targetLanguage: payload['targetLanguage'].toString(),
                exampleSentence: payload['exampleSentence']?.toString(),
                note: payload['note']?.toString(),
              );
              break;

            case 'delete-flashcard':
              final cardId = payload['cardId'] ?? payload['id'];
              await _flashcardApi.deleteFlashcard(cardId.toString());
              break;

            case 'review-flashcard':
              final cardId = payload['cardId'] ?? payload['id'];
              await _flashcardApi.reviewCard(
                cardId.toString(),
                payload['score'] as int? ?? 4,
              );
              break;
          }
          // A request already dispatched used the original session. If that
          // session changed while awaiting it, retain the queue without acking.
          if (!sessionMatches()) return false;
        } catch (e) {
          if (!sessionMatches()) return false;
          // If a request fails, keep it in the queue to attempt again later
          debugPrint('Failed to run offline action ${action.type}: $e');
          remaining.add(action);
          success = false;
        }
      }

      // Overwrite storage with remaining failed actions (if any)
      if (!sessionMatches()) return false;
      final saved = await _saveQueue(owner, remaining, sessionMatches: sessionMatches);
      return saved && success;
    } finally {
      // Release processing lock when finished
      _isProcessing = false;
    }
  }
}
