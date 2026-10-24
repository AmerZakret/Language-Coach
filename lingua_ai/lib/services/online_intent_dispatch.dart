import 'dart:convert';
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/config/api_config.dart';
import 'auth_service.dart';
import 'mutation_request.dart';
import 'backend_http.dart' as http;
import 'client_compatibility.dart';
import 'connectivity_service.dart';
import 'community_feed_cache.dart';
import 'online_intent_service.dart';

Future<Map<String, dynamic>> _dispatch(
    Map<String, dynamic> intent, SessionSnapshot session) async {
  if (!session.isCurrent) throw const IntentRecoveryRequired();
  final headers = {
    'Authorization': 'Bearer ${AuthService().token}',
    'X-Idempotency-Key': intent['id'] as String
  };
  final payload = Map<String, dynamic>.from(intent['payload']);
  final kind = intent['kind'];
  final response = await mutationRequest(() {
    if (!session.isCurrent) throw const IntentRecoveryRequired();
    if (kind == 'community-create') {
      final request = http.MultipartRequest(
          'POST', Uri.parse('${ApiConfig.baseUrl}${ApiConfig.communityPosts}'))
        ..headers.addAll(headers)
        ..fields.addAll(Map<String, String>.from(payload['fields']));
      for (final file in payload['files']) {
        request.files.add(http.MultipartFile.fromBytes(
            file['field'], base64Decode(file['bytes']),
            filename: file['filename'],
            contentType: MediaType.parse(file['contentType'])));
      }
      return http.sendMultipart(request).timeout(const Duration(seconds: 45));
    }
    if (kind == 'ai-send') {
      return http
          .post(Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}/chat'),
              headers: {...headers, 'Content-Type': 'application/json'},
              body: jsonEncode(payload))
          .timeout(const Duration(seconds: 45));
    }
    return http
        .delete(
            Uri.parse('${ApiConfig.baseUrl}${ApiConfig.aiCoach}/clear').replace(
                queryParameters: {'targetLanguage': intent['language']}),
            headers: headers)
        .timeout(const Duration(seconds: 45));
  }, session);
  return Map<String, dynamic>.from(jsonDecode(response.body));
}

Future<void> _accept(
    Map<String, dynamic> result, Map<String, dynamic> intent) async {
  if (intent['kind'] == 'community-create') {
    if (result['_id'] is! String || (result['_id'] as String).isEmpty) {
      throw const FormatException(
          'Missing post acknowledgement. Saved action is preserved.');
    }
    await CommunityFeedCache.invalidate(
        await SharedPreferences.getInstance(), intent['ownerNamespace'],
        language: intent['language'], requireAcknowledgement: true);
  } else if (intent['kind'] == 'ai-send') {
    if (result['reply'] is! String) {
      throw const FormatException('Missing chat acknowledgement.');
    }
  } else if (result['success'] != true) {
    throw const FormatException('Missing clear acknowledgement.');
  }
}

Future<Map<String, dynamic>> replayOnlineIntent(String id) =>
    OnlineIntentService.run(id, _dispatch, _accept);

Future<Map<String, dynamic>> durableOnlineMutation(
    String kind, String language, Map<String, dynamic> payload,
    {String? operationId, SessionSnapshot? expectedSession}) async {
  if (expectedSession != null && !expectedSession.isCurrent) {
    throw const IntentRecoveryRequired();
  }
  final intent = await OnlineIntentService.prepare(kind, language, payload,
      operationId: operationId);
  return replayOnlineIntent(intent['id']);
}

Future<void> recoverOnlineIntents(String kind, {String? language}) async {
  final session = AuthService().captureSession();
  if (ConnectivityService().isOffline || AuthService().token.isEmpty ||
      ClientCompatibility().updateRequired ||
      OnlineIntentService.isDispatching(session.ownerNamespace)) {
    return;
  }
  final intents = await OnlineIntentService.list();
  for (final intent in intents) {
    if (!session.isCurrent) return;
    if (!(intent['kind'] as String)
            .startsWith(kind == 'ai' ? 'ai-' : 'community-') ||
        (language != null && intent['language'] != language)) {
      continue;
    }
    if (intent['state'] == 'failed' ||
        intent['nextAttemptAt'] > OnlineIntentService.clock()) {
      throw const IntentRecoveryRequired();
    }
    await replayOnlineIntent(intent['id']);
  }
}
