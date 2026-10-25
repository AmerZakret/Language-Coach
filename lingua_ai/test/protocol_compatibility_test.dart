import 'package:flutter/material.dart';
import 'package:lingua_ai/widgets/client_compatibility_boundary.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/core/config/api_config.dart';
import 'package:lingua_ai/core/config/client_protocol.dart';
import 'package:lingua_ai/services/backend_http.dart' as backend;
import 'package:lingua_ai/services/client_compatibility.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/auth_api_service.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';
import 'package:lingua_ai/services/sync_retry_policy.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const ownerId = '507f1f77bcf86cd799439011';
  const owner = 'guest_$ownerId';
  final auth = AuthService();
  setUp(() async {
    ClientCompatibility().resetForTesting();
    SyncStorage.backend = PreferencesSyncStorage();
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    await auth.setGuestSession(
        id: ownerId,
        email: 'guest-fixture@guest.lingua.local',
        token: 'fixture-token');
  });
  tearDown(() {
    ClientCompatibility().resetForTesting();
    SyncStorage.backend = PreferencesSyncStorage();
  });
  test(
      '9C Flutter constant matches source-executed backend/web revisions; build identity is independent',
      () async {
    final result = await Process.run(
        'node', ['../scripts/check-release-contract.cjs', '--json']);
    expect(result.exitCode, 0, reason: result.stderr.toString());
    final data = jsonDecode(result.stdout.toString()) as Map;
    expect(ClientProtocol.revision, data['backend']['currentProtocolRevision']);
    expect(ClientProtocol.header, data['backend']['protocolHeader']);
    expect(ClientProtocol.revision, data['web']['protocolRevision']);
    expect(ClientProtocol.developmentBuildId, 'development');
    expect(ClientProtocol.validBuildId(ClientProtocol.buildId), true);
    expect(ClientProtocol.buildId,
        const String.fromEnvironment('BUILD_ID', defaultValue: 'development'));
    expect(ClientProtocol.buildId, isNot(ClientProtocol.revision.toString()));
    expect(ClientProtocol.validBuildId('../private'), false);
  });
  test(
      '9C direct auth/guest and backend reads all use central header without dropping content/auth fields',
      () async {
    final paths = <String>[];
    await http.runWithClient(() async {
      await AuthApiService().login('fixture@example.invalid', 'fixture');
      await AuthApiService()
          .register('Fixture', 'fixture@example.invalid', 'fixture');
      await AuthApiService().loginGuest();
      await backend.get(Uri.parse('${ApiConfig.baseUrl}/lessons'),
          headers: {'X-Extra': 'preserved'});
      await ProgressApiService().getProgress(ownerId, 'en');
    },
        () => MockClient((request) async {
              paths.add(request.url.path);
              expect(request.headers[ClientProtocol.header],
                  '${ClientProtocol.revision}');
              if (request.url.path == '/lessons') {
                expect(request.headers['X-Extra'], 'preserved');
              }
              if (request.url.path.startsWith('/progress/')) {
                expect(
                    request.headers['Authorization'], 'Bearer fixture-token');
              }
              return http.Response(
                  jsonEncode(request.url.path.startsWith('/auth/')
                      ? {
                          'access_token': 'fixture-token',
                          'user': {
                            'id': ownerId,
                            'name': 'Fixture',
                            'email': 'fixture@example.invalid',
                            'isGuest': true,
                            'targetLanguage': 'en'
                          }
                        }
                      : {}),
                  200);
            }));
    expect(paths, [
      '/auth/login',
      '/auth/register',
      '/auth/guest',
      '/lessons',
      '/progress/$ownerId'
    ]);
  });
  test(
      '9C all four current flashcard operations require and retain the caller stable key',
      () async {
    final api = FlashcardApiService();
    final paths = <String>[];
    await http.runWithClient(() async {
      await api.createFlashcard('word', 'translation', 'en',
          operationId: 'create-stable');
      await api.updateFlashcard('card', 'word', 'translation',
          operationId: 'update-stable');
      await api.reviewCard('card', 4, operationId: 'review-stable');
      await api.deleteFlashcard('card', operationId: 'delete-stable');
    },
        () => MockClient((request) async {
              paths.add(request.url.path);
              final operation = request.method == 'POST'
                  ? 'create'
                  : request.method == 'DELETE'
                      ? 'delete'
                      : request.url.path.endsWith('/review')
                          ? 'review'
                          : 'update';
              expect(request.headers['X-Idempotency-Key'], '$operation-stable');
              expect(request.headers[ClientProtocol.header],
                  '${ClientProtocol.revision}');
              return http.Response('{"_id":"card"}', 200);
            }));
    expect(paths, hasLength(4));
  });
  test(
      '9C compatibility has its own error kind and blocks writes while retaining auth and reads',
      () async {
    final session = auth.captureSession();
    var calls = 0;
    await http.runWithClient(() async {
      await expectLater(
          backend.post(Uri.parse('${ApiConfig.baseUrl}/flashcards')),
          throwsA(isA<ApiException>()
              .having((e) => e.kind, 'kind', ApiFailure.compatibility)));
      expect(ClientCompatibility().updateRequired, true);
      expect(session.isCurrent, true);
      await expectLater(
          backend.delete(Uri.parse('${ApiConfig.baseUrl}/ai-coach/clear')),
          throwsA(isA<ApiException>()
              .having((e) => e.kind, 'kind', ApiFailure.compatibility)));
      await backend.get(Uri.parse('${ApiConfig.baseUrl}/flashcards/all'));
    },
        () => MockClient((request) async {
              calls++;
              return request.method == 'GET'
                  ? http.Response('[]', 200)
                  : http.Response(
                      '{"code":"CLIENT_PROTOCOL_UNSUPPORTED"}', 426);
            }));
    expect(calls, 2);
    expect(
        SyncFailure.classify(const ApiException(ApiFailure.compatibility,
                'fixture', 426, false, 'CLIENT_PROTOCOL_REQUIRED'))
            .category,
        'compatibility');
    expect(
        SyncFailure.classify(
                const ApiException(ApiFailure.compatibility, 'fixture', 426))
            .terminal,
        false);
  });
  test(
      '9C real durable two-slot queue survives protocol rejection and reopened store without quarantine or relabeling',
      () async {
    final directory =
        await Directory.systemTemp.createTemp('protocol-durable-');
    try {
      SyncStorage.backend = FileSyncStorage(() async => directory);
      final queue = OfflineQueueService.forTesting(
          progressApi: ProgressApiService(),
          flashcardApi: FlashcardApiService());
      await queue.pushAction('review-flashcard', {'id': 'card', 'score': 4},
          ownerNamespace: owner, operationId: 'durable-review');
      final before = (await queue.getQueue()).single;
      expect(before.clientProtocolRevision, ClientProtocol.revision);
      var calls = 0;
      await http.runWithClient(() async {
        expect(await queue.processQueue(ownerId), false);
        final stored = jsonEncode(await SyncStorage.backend.read(owner));
        expect(await queue.processQueue(ownerId), false);
        expect(jsonEncode(await SyncStorage.backend.read(owner)), stored);
      },
          () => MockClient((request) async {
                calls++;
                expect(request.headers['X-Idempotency-Key'], before.id);
                expect(request.headers[ClientProtocol.header],
                    '${before.clientProtocolRevision}');
                return http.Response(
                    '{"code":"CLIENT_PROTOCOL_UNSUPPORTED"}', 426);
              }));
      expect(calls, 1);
      SyncStorage.backend = FileSyncStorage(() async => directory);
      final reopened = (await queue.getQueue()).single;
      expect(reopened.id, before.id);
      expect(reopened.payload, before.payload);
      expect(reopened.ownerNamespace, owner);
      expect(reopened.clientProtocolRevision, before.clientProtocolRevision);
      expect(reopened.failedAt, isNull);
      expect(await queue.getFailedActions(), isEmpty);
      expect(auth.localStorageNamespace, owner);
    } finally {
      SyncStorage.backend = PreferencesSyncStorage();
      await directory.delete(recursive: true);
    }
  });
  test(
      '9C legacy/older queued protocol is never silently upgraded by new transport',
      () async {
    await http.runWithClient(() async {
      await ClientProtocol.withRecordedRevision(
          null,
          () => backend.put(
              Uri.parse('${ApiConfig.baseUrl}/flashcards/card/review'),
              headers: {'X-Idempotency-Key': 'legacy-review'}));
      await ClientProtocol.withRecordedRevision(
          0,
          () => backend.put(
              Uri.parse('${ApiConfig.baseUrl}/flashcards/card/review'),
              headers: {'X-Idempotency-Key': 'old-review'}));
    },
        () => MockClient((request) async {
              expect(
                  request.headers[ClientProtocol.header],
                  request.headers['X-Idempotency-Key'] == 'legacy-review'
                      ? isNull
                      : '0');
              return http.Response('{}', 200);
            }));
  });
  test(
      '9C multipart includes protocol/key; external selected media never receives backend metadata',
      () async {
    var calls = 0;
    await http.runWithClient(() async {
      final request = http.MultipartRequest(
          'POST', Uri.parse('${ApiConfig.baseUrl}/community/posts'))
        ..headers['X-Idempotency-Key'] = 'multipart-stable'
        ..headers['Authorization'] = 'Bearer fixture-token'
        ..fields['text'] = 'fixture';
      await backend.sendMultipart(request);
      await backend.get(Uri.parse('https://media.example.invalid/image.png'));
    },
        () => MockClient((request) async {
              calls++;
              expect(request.headers[ClientProtocol.header],
                  calls == 1 ? '${ClientProtocol.revision}' : isNull);
              if (calls == 1) {
                expect(
                    request.headers['X-Idempotency-Key'], 'multipart-stable');
                expect(request.body, contains('fixture'));
              }
              return http.Response('{}', 200);
            }));
    expect(calls, 2);
  });
  test('9C backend services cannot bypass the centralized HTTP import boundary',
      () {
    const allowed = {
      'backend_http.dart',
      'api_response.dart',
      'offline_queue_service.dart',
      'connectivity_service.dart'
    };
    for (final file in Directory('lib/services').listSync().whereType<File>()) {
      if (file.readAsStringSync().contains("import 'package:http/http.dart'")) {
        expect(allowed, contains(file.uri.pathSegments.last));
      }
    }
  });
  testWidgets(
      '9C application update-required notice preserves the mounted draft and session',
      (tester) async {
    final controller = TextEditingController(text: 'retained draft');
    final session = auth.captureSession();
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ClientCompatibilityBoundary(
                child: TextField(controller: controller)))));
    expect(find.textContaining('mutations are paused'), findsNothing);
    ClientCompatibility().requireUpdate();
    await tester.pump();
    expect(find.textContaining('mutations are paused'), findsOneWidget);
    expect(controller.text, 'retained draft');
    expect(session.isCurrent, true);
    await tester.pumpWidget(const SizedBox.shrink());
    controller.dispose();
  });
}
