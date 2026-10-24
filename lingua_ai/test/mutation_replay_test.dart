import 'package:lingua_ai/services/online_intent_service.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/ai_coach_api_service.dart';
import 'package:lingua_ai/services/community_service.dart';
import 'package:lingua_ai/services/community_feed_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011', b = '507f1f77bcf86cd799439012';
  final auth = AuthService();
  var clock = DateTime.now().millisecondsSinceEpoch;
  void advance() { clock += 300001; }
  Future<void> login(String id) async {
    auth.setBackendSession(
        id: id, name: id, email: '$id@example.test', token: 'token-$id');
    for (var i = 0; i < 12; i++) {
      await Future<void>.value();
    }
  }

  final post = {
    '_id': 'post',
    'userId': a,
    'userName': 'A',
    'learningLanguage': 'en',
    'text': 'caption',
    'likes': [],
    'likesCount': 0,
    'likedByMe': false,
    'revision': 0,
    'createdAt': '2026-01-01',
    'updatedAt': '2026-01-01'
  };
  setUp(() async {
    OnlineIntentService.clock = () => clock;
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await login(a);
  });

  tearDown(() { OnlineIntentService.clock = () => DateTime.now().millisecondsSinceEpoch; });

  test(
      'image create keeps operation ID and captured bytes after lost ack and source removal',
      () async {
    final directory =
        await Directory.systemTemp.createTemp('lingua-7e-client-');
    final file = File('${directory.path}${Platform.pathSeparator}image.png');
    await file.writeAsBytes(utf8.encode('original-image-bytes'));
    final service = CommunityService();
    final keys = <String>[];
    var failures = 2;
    try {
      await http.runWithClient(() async {
        await expectLater(
            service.createPost(
                learningLanguage: 'en', text: 'caption', imagePath: file.path),
            throwsA(isA<ApiException>()));
        await file.delete();
        advance();
        await CommunityService().createPost(
            learningLanguage: 'en', text: 'caption', imagePath: file.path);
        expect(keys.toSet(), hasLength(1));
        await service.createPost(learningLanguage: 'en', text: 'caption');
        expect(keys.last, isNot(keys.first));
      },
          () => MockClient((request) async {
                if (!request.url.path.contains('/community/posts')) {
                  return http.Response('{}', 200);
                }
                keys.add(request.headers['X-Idempotency-Key']!);
                if (keys.length <= 3) {
                  expect(request.body, contains('original-image-bytes'));
                }
                if (failures-- > 0) return http.Response('{}', 503);
                return http.Response(jsonEncode(post), 201);
              }));
    } finally {
      if (!directory.absolute.path.startsWith(
          '${Directory.systemTemp.absolute.path}${Platform.pathSeparator}lingua-7e-client-')) {
        throw StateError('Unsafe cleanup');
      }
      await directory.delete(recursive: true);
    }
  });

  test(
      'reaction retry preserves desired state/key and never applies a local count delta',
      () async {
    final service = CommunityService(), keys = <String>[], bodies = <String>[];
    var calls = 0;
    await http.runWithClient(() async {
      final result = await service.toggleLike(postId: 'post', liked: true);
      expect(result, {'likesCount': 7, 'likedByMe': true});
      expect(keys.toSet(), hasLength(1));
      expect(bodies.toSet(), {'{"liked":true}'});
    },
        () => MockClient((request) async {
              keys.add(request.headers['X-Idempotency-Key']!);
              bodies.add(request.body);
              if (++calls == 1) {
                throw http.ClientException('Lost acknowledgement');
              }
              return http.Response('{"likesCount":7,"likedByMe":true}', 201);
            }));
  });

  test('same-device opposite reactions dispatch in intent order', () async {
    final service = CommunityService(), firstStarted = Completer<void>();
    final firstAck = Completer<http.Response>(), states = <bool>[];
    await http.runWithClient(() async {
      final like = service.toggleLike(postId: 'post', liked: true);
      await firstStarted.future;
      final unlike = service.toggleLike(postId: 'post', liked: false);
      await Future<void>.value();
      expect(states, [true]);
      firstAck
          .complete(http.Response('{"likesCount":1,"likedByMe":true}', 201));
      await like;
      expect((await unlike)['likedByMe'], false);
      expect(states, [true, false]);
    },
        () => MockClient((request) {
              final liked = jsonDecode(request.body)['liked'] as bool;
              states.add(liked);
              if (liked) {
                firstStarted.complete();
                return firstAck.future;
              }
              return Future.value(
                  http.Response('{"likesCount":0,"likedByMe":false}', 201));
            }));
  });

  test(
      'unresolved explicit image keys reject changed payload without replaying a cached request',
      () async {
    final service = CommunityService();
    var calls = 0;
    await http.runWithClient(() async {
      await expectLater(
          service.createPost(
              learningLanguage: 'en',
              text: 'original',
              operationId: 'explicit'),
          throwsA(isA<ApiException>()));
      expect(calls, 2);
      await expectLater(
          service.createPost(
              learningLanguage: 'en', text: 'changed', operationId: 'explicit'),
          throwsA(isA<ApiException>()
              .having((e) => e.code, 'code', 'IDEMPOTENCY_CONFLICT')));
      expect(calls, 2);
    },
        () => MockClient((request) async {
              calls++;
              return http.Response('{}', 503);
            }));
  });

  test(
      'explicit operation ID under another owner never reuses the first owner multipart snapshot',
      () async {
    final service = CommunityService(),
        tokens = <String>[],
        bodies = <String>[];
    var fail = true;
    await http.runWithClient(() async {
      await expectLater(
          service.createPost(
              learningLanguage: 'en', text: 'A caption', operationId: 'shared'),
          throwsA(isA<ApiException>()));
      await login(b);
      fail = false;
      await service.createPost(
          learningLanguage: 'en', text: 'B caption', operationId: 'shared');
      expect(tokens, ['Bearer token-$a', 'Bearer token-$a', 'Bearer token-$b']);
      expect(bodies.last, contains('B caption'));
      expect(bodies.last, isNot(contains('A caption')));
    },
        () => MockClient((request) async {
              if (!request.url.path.contains('/community/posts')) {
                return http.Response('{}', 200);
              }
              tokens.add(request.headers['Authorization']!);
              bodies.add(request.body);
              return fail
                  ? http.Response('{}', 503)
                  : http.Response(jsonEncode({...post, 'userId': b}), 201);
            }));
  });

  for (final operation in ['send', 'clear']) {
    test(
        'AI $operation retains unresolved logical key and assigns a fresh key after acknowledgement',
        () async {
      final service = AiCoachApiService(), keys = <String>[];
      var failures = 2;
      Future<dynamic> mutate() => operation == 'send'
          ? service.sendMessage(
              message: 'hello', language: 'en', targetLanguage: 'de')
          : service.clearHistory(targetLanguage: 'de');
      await http.runWithClient(() async {
        await expectLater(mutate(), throwsA(isA<ApiException>()));
        advance();
        await mutate();
        expect(keys.toSet(), hasLength(1));
        await mutate();
        expect(keys.last, isNot(keys.first));
      },
          () => MockClient((request) async {
                keys.add(request.headers['X-Idempotency-Key']!);
                expect(request.headers['Authorization'], 'Bearer token-$a');
                if (operation == 'send') {
                  expect(jsonDecode(request.body)['targetLanguage'], 'de');
                } else {
                  expect(request.url.queryParameters['targetLanguage'], 'de');
                }
                if (failures-- > 0) return http.Response('{}', 503);
                return http.Response(
                    operation == 'send'
                        ? '{"saved":true,"reply":"reply","userMessage":{},"assistantMessage":{}}'
                        : '{"success":true}',
                    200);
              }));
    });
  }

  test(
      'owner switch during uncertain send stops retries using replacement credentials',
      () async {
    final started = Completer<void>(), response = Completer<http.Response>();
    var calls = 0;
    await http.runWithClient(() async {
      final work = AiCoachApiService()
          .sendMessage(message: 'old', language: 'en', targetLanguage: 'en');
      final assertion = expectLater(work, throwsA(isA<ApiException>()));
      await started.future;
      await login(b);
      response.complete(http.Response('{}', 503));
      await assertion;
      expect(calls, 1);
      expect(auth.currentUserId, b);
    },
        () => MockClient((request) {
              if (!request.url.path.contains('/ai-coach/chat')) {
                return Future.value(http.Response('{}', 200));
              }
              calls++;
              expect(request.headers['Authorization'], 'Bearer token-$a');
              started.complete();
              return response.future;
            }));
  });

  test('uncertain clear blocks later send until original clear is reconciled', () async {
    final service = AiCoachApiService(), clearKeys = <String>[], sendKeys = <String>[];
    var clearFailures = 2;
    await http.runWithClient(() async {
      await expectLater(service.clearHistory(targetLanguage: 'en'), throwsA(isA<ApiException>()));
      await expectLater(service.sendMessage(message: 'later', language: 'en', targetLanguage: 'en'), throwsA(isA<IntentRecoveryRequired>()));
      expect(sendKeys, isEmpty);
      advance();
      await service.clearHistory(targetLanguage: 'en');
      await service.sendMessage(message: 'later', language: 'en', targetLanguage: 'en');
      expect(clearKeys.toSet(), hasLength(1));
      expect(sendKeys, hasLength(1));
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/clear')) {
        clearKeys.add(request.headers['X-Idempotency-Key']!);
        return http.Response('{"success":true}', clearFailures-- > 0 ? 503 : 200);
      }
      sendKeys.add(request.headers['X-Idempotency-Key']!);
      return http.Response('{"reply":"later reply"}', 200);
    }));
  });

  test('explicit old clear replay cannot retire a later send intent', () async {
    final service = AiCoachApiService(), sendKeys = <String>[];
    var failures = 2;
    await http.runWithClient(() async {
      await service.clearHistory(targetLanguage: 'en', operationId: 'clear');
      await expectLater(service.sendMessage(message: 'later', language: 'en', targetLanguage: 'en'), throwsA(isA<ApiException>()));
      advance();
      await service.sendMessage(message: 'later', language: 'en', targetLanguage: 'en');
      await service.clearHistory(targetLanguage: 'en', operationId: 'clear');
      expect(sendKeys.toSet(), hasLength(1));
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/clear')) return http.Response('{"success":true}', 200);
      sendKeys.add(request.headers['X-Idempotency-Key']!);
      return http.Response('{"reply":"reply"}', failures-- > 0 ? 503 : 200);
    }));
  });

  test(
      'late Community acknowledgement after language change leaves owner cache intact',
      () async {
    final prefs = await SharedPreferences.getInstance();
    final query = CommunityQuery('registered_$a');
    await CommunityFeedCache.write(prefs, query, {
      'items': [post],
      'page': 1,
      'limit': 50,
      'total': 1,
      'hasMore': false
    });
    final before = prefs.getString(query.key);
    var current = true;
    await http.runWithClient(() async {
      await expectLater(
          CommunityService().toggleLike(
              postId: 'post', liked: true, isCurrent: () => current),
          throwsStateError);
      expect(prefs.getString(query.key), before);
    },
        () => MockClient((request) async {
              current = false;
              return http.Response('{"likesCount":1,"likedByMe":true}', 201);
            }));
  });
}
