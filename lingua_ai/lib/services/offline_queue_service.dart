import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'progress_api_service.dart';
import 'flashcard_api_service.dart';

/// Model representing a single user action completed while offline.
/// Stores action IDs, operation types (e.g. 'complete-lesson', 'create-flashcard'), and the JSON payload.
class OfflineQueueAction {
  final String id;
  final String type;
  final Map<String, dynamic> payload;

  OfflineQueueAction({
    required this.id,
    required this.type,
    required this.payload,
  });

  // Convert model instance to a JSON Map for local storage serialization
  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'payload': payload,
      };

  // Create model instance from deserialized JSON Map
  factory OfflineQueueAction.fromJson(Map<String, dynamic> json) {
    return OfflineQueueAction(
      id: json['id'] ?? '',
      type: json['type'] ?? '',
      payload: Map<String, dynamic>.from(json['payload'] ?? {}),
    );
  }
}

/// Service managing offline mutation serialization, storage, and backend synchronization.
class OfflineQueueService {
  // Key name for local SharedPreferences list storage
  static const String _storageKey = 'linguaai_offline_queue';
  
  // Singleton pattern instantiation
  static final OfflineQueueService _instance = OfflineQueueService._internal();
  factory OfflineQueueService() => _instance;
  OfflineQueueService._internal();

  // API service connectors to post actions to NestJS backend endpoints
  final ProgressApiService _progressApi = ProgressApiService();
  final FlashcardApiService _flashcardApi = FlashcardApiService();
  
  // Concurrency lock preventing multiple sync threads from draining the queue simultaneously
  bool _isProcessing = false;

  /// Retrieves the list of pending offline actions from local SharedPreferences.
  Future<List<OfflineQueueAction>> getQueue() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getStringList(_storageKey);
    if (data == null) return [];
    try {
      return data
          .map((item) => OfflineQueueAction.fromJson(json.decode(item)))
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Persists the list of offline actions back to SharedPreferences.
  Future<void> saveQueue(List<OfflineQueueAction> queue) async {
    final prefs = await SharedPreferences.getInstance();
    final data = queue.map((action) => json.encode(action.toJson())).toList();
    await prefs.setStringList(_storageKey, data);
  }

  /// Appends a new user action to the queue when a network write error occurs.
  Future<void> pushAction(String type, Map<String, dynamic> payload) async {
    final queue = await getQueue();
    final action = OfflineQueueAction(
      // Generate a unique action ID based on timestamp and data hash
      id: 'action_${DateTime.now().millisecondsSinceEpoch}_${payload.hashCode}',
      type: type,
      payload: payload,
    );
    queue.add(action);
    await saveQueue(queue);
    debugPrint('Pushed action to offline queue: $type');
  }

  /// Synchronizes all queued local operations with the backend when connection is restored.
  /// Iterates through queued items chronologically and maps temporary IDs to final database IDs.
  Future<bool> processQueue(String userId) async {
    // Return early if synchronization is already running to avoid network duplication
    if (_isProcessing) {
      debugPrint('OfflineQueueService: processQueue is already running, skipping duplicate call.');
      return false;
    }
    _isProcessing = true;
    try {
      final queue = await getQueue();
      if (queue.isEmpty) return true;

      debugPrint('Processing ${queue.length} offline actions for user $userId...');
      
      // Maps client-generated temporary IDs (e.g. 'local_171') to official server ObjectIds
      final idMap = <String, String>{};
      final List<OfflineQueueAction> remaining = [];
      bool success = true;

      for (var action in queue) {
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
        } catch (e) {
          // If a request fails, keep it in the queue to attempt again later
          debugPrint('Failed to run offline action ${action.type}: $e');
          remaining.add(action);
          success = false;
        }
      }

      // Overwrite storage with remaining failed actions (if any)
      await saveQueue(remaining);
      return success;
    } finally {
      // Release processing lock when finished
      _isProcessing = false;
    }
  }
}
