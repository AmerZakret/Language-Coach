import 'package:lingua_ai/services/data_timeline.dart';
import 'package:lingua_ai/services/community_feed_cache.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/client_compatibility.dart';
import 'package:lingua_ai/services/online_intent_service.dart';
import 'package:lingua_ai/services/online_intent_dispatch.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011', b = '507f1f77bcf86cd799439012';
  const owner = 'guest_$a';
  final auth = AuthService();
  late Directory directory;
  late int clock;
  final send = <String, dynamic>{
    'message': 'hello',
    'language': 'en',
    'targetLanguage': 'en'
  };
  Future<void> login(String id) => auth.setGuestSession(
      id: id, email: '$id@guest.lingua.local', token: 'fixture-$id');
  Future<Map<String, dynamic>> stored() async =>
      (await SyncStorage.intents.read(owner))!;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    ClientCompatibility().resetForTesting();
    directory = await Directory.systemTemp.createTemp('lingua-intents-');
    SyncStorage.intents = FileSyncStorage(() async => directory);
    clock = DateTime.now().millisecondsSinceEpoch;
    OnlineIntentService.clock = () => clock;
    await auth.init();
    await login(a);
  });
  tearDown(() async {
    SyncStorage.intents =
        PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
    OnlineIntentService.clock = () => DateTime.now().millisecondsSinceEpoch;
    ClientCompatibility().resetForTesting();
    if (directory.parent.absolute.path != Directory.systemTemp.absolute.path ||
        !directory.path
            .split(Platform.pathSeparator)
            .last
            .startsWith('lingua-intents-')) {
      throw StateError('Unsafe fixture cleanup');
    }
    await directory.delete(recursive: true);
  });

  for (final kind in ['community-create', 'ai-send', 'ai-clear']) {
    test(
        '9D $kind persists before dispatch; lost ack survives file-store reopen with same receipt identity',
        () async {
      final payload = kind == 'community-create'
          ? <String, dynamic>{
              'fields': {'learningLanguage': 'en', 'text': 'post'},
              'files': <dynamic>[]
            }
          : kind == 'ai-send'
              ? send
              : <String, dynamic>{'targetLanguage': 'en'};
      final receipts = <String, Map<String, dynamic>>{};
      var writes = 0, providers = 0, requests = 0;
      await http.runWithClient(() async {
        await expectLater(durableOnlineMutation(kind, 'en', payload),
            throwsA(isA<ApiException>()));
      },
          () => MockClient((request) async {
                final intent = (await stored())['intents'].single;
                expect(request.headers['X-Idempotency-Key'], intent['id']);
                expect(request.headers['X-Client-Protocol'], '2');
                expect(jsonEncode(intent), isNot(contains('fixture-$a')));
                requests++;
                receipts.putIfAbsent(intent['id'], () {
                  writes++;
                  if (kind == 'ai-send') providers++;
                  return kind == 'community-create'
                      ? {'_id': 'one-post'}
                      : kind == 'ai-send'
                          ? {
                              'reply': 'one-reply',
                              'userMessage': {'_id': 'user'},
                              'assistantMessage': {'_id': 'assistant'}
                            }
                          : {'success': true};
                });
                return http.Response('{}', 503);
              }));
      expect(requests, 2);
      final original = (await stored())['intents'].single;
      SyncStorage.intents = FileSyncStorage(() async => directory);
      clock += 300001;
      await http.runWithClient(
          () => recoverOnlineIntents(
              kind.startsWith('ai-') ? 'ai' : 'community',
              language: 'en'),
          () => MockClient((request) async {
                expect(request.headers['X-Idempotency-Key'], original['id']);
                return http.Response(jsonEncode(receipts[original['id']]), 200);
              }));
      expect((await stored())['intents'], isEmpty);
      expect(writes, 1);
      expect(providers, kind == 'ai-send' ? 1 : 0);
    });
  }

  for (final status in [401, 426, 429, 503, 409, 400]) {
    test('9D HTTP $status preserves original identity and explicit error state',
        () async {
      await http.runWithClient(() async {
        await expectLater(
            durableOnlineMutation('ai-clear', 'en', {'targetLanguage': 'en'}),
            throwsA(isA<ApiException>()));
      },
          () => MockClient((_) async => http.Response(
              jsonEncode({
                'code': status == 426
                    ? 'CLIENT_PROTOCOL_UNSUPPORTED'
                    : 'IDEMPOTENCY_CONFLICT'
              }),
              status,
              headers: status == 429 ? {'retry-after': '900'} : {})));
      final intent = (await stored())['intents'].single;
      expect(
          intent['state'], [400, 409].contains(status) ? 'failed' : 'pending');
      expect(intent['protocol'], 2);
      if ([429, 503].contains(status)) {
        expect(intent['nextAttemptAt'], greaterThan(clock));
      }
      if (status == 429) {
        expect(intent['nextAttemptAt'], clock + 300000);
      }
      if (status == 426) {
        expect(ClientCompatibility().updateRequired, true);
        final before = jsonEncode(await stored());
        await recoverOnlineIntents('ai', language: 'en');
        expect(jsonEncode(await stored()), before);
      }
      if (status == 401) {
        await login(b);
        await recoverOnlineIntents('ai', language: 'en');
        expect((await stored())['intents'].single['id'], intent['id']);
      }
    });
  }

  test(
      '9D local acknowledgement failure retains result/identity; reopen accepts without another request',
      () async {
    final intent = await OnlineIntentService.prepare('ai-send', 'en', send);
    await expectLater(
        OnlineIntentService.run(
            intent['id'], (_, unused) async => {'reply': 'saved'},
            (_, unused) async {
          throw StateError('local acceptance interrupted');
        }),
        throwsStateError);
    expect((await stored())['intents'].single['state'], 'acknowledged');
    SyncStorage.intents = FileSyncStorage(() async => directory);
    await OnlineIntentService.run(intent['id'],
        (_, unused) async => throw StateError('must not dispatch'),
        (result, _) async {
      expect(result['reply'], 'saved');
    });
    expect((await stored())['intents'], isEmpty);
  });

  test(
      '9D cache I/O exception cannot remove an acknowledged intent before local acceptance',
      () async {
    final intent = await OnlineIntentService.prepare('community-create', 'en', {
      'fields': {'learningLanguage': 'en', 'text': 'post'},
      'files': <dynamic>[]
    });
    final broken = _BrokenCache(owner);
    await expectLater(
        OnlineIntentService.run(
            intent['id'],
            (_, unused) async => {'_id': 'post'},
            (_, unused) => CommunityFeedCache.invalidate(broken, owner,
                language: 'en', requireAcknowledgement: true)),
        throwsStateError);
    expect((await stored())['intents'].single['state'], 'acknowledged');
    expect((await stored())['intents'].single['id'], intent['id']);
  });

  test(
      '9D owner switch while response is pending keeps the old owner intent and never accepts it as the new owner',
      () async {
    final started = Completer<void>(), response = Completer<http.Response>();
    await http.runWithClient(() async {
      final pending = durableOnlineMutation('ai-send', 'en', send);
      final assertion = expectLater(pending, throwsStateError);
      await started.future;
      final id = (await stored())['intents'].single['id'];
      await login(b);
      response.complete(http.Response('{"reply":"old-owner"}', 200));
      await assertion;
      expect((await stored())['intents'].single['id'], id);
      await recoverOnlineIntents('ai', language: 'en');
      expect(await OnlineIntentService.list(), isEmpty);
    },
        () => MockClient((_) {
              started.complete();
              return response.future;
            }));
  });

  test(
      '9D verified backup is exposed on primary corruption; evidence is preserved and no automatic dispatch or overwrite occurs',
      () async {
    final intent = await OnlineIntentService.prepare('ai-send', 'en', send);
    // Mirror an unchanged snapshot so the verified backup contains this intent.
    await SyncStorage.intents.write(owner, await stored());
    final primary =
        File('${directory.path}${Platform.pathSeparator}$owner.0.json');
    await primary.writeAsString('corrupt primary evidence');
    SyncStorage.intents = FileSyncStorage(() async => directory);
    try {
      await OnlineIntentService.list();
      fail('must fail closed');
    } on SyncStorageCorruption catch (error) {
      expect(error.previousValid?['intents'].single['id'], intent['id']);
    }
    var requests = 0;
    await http.runWithClient(() async {
      await expectLater(
          recoverOnlineIntents('ai'), throwsA(isA<SyncStorageCorruption>()));
    },
        () => MockClient((_) async {
              requests++;
              return http.Response('{}', 200);
            }));
    expect(requests, 0);
    expect(await primary.readAsString(), 'corrupt primary evidence');
  });

  test(
      '9D storage failure prevents dispatch; capacity never evicts unresolved work',
      () async {
    for (final language in ['en', 'de', 'es', 'fr', 'ar']) {
      await OnlineIntentService.prepare('community-create', language, {
        'fields': {'learningLanguage': language, 'text': 'post'},
        'files': <dynamic>[]
      });
    }
    for (final language in ['en', 'de', 'es']) {
      await OnlineIntentService.prepare(
          'ai-clear', language, {'targetLanguage': language});
    }
    final before = jsonEncode(await stored());
    await expectLater(
        OnlineIntentService.prepare('ai-clear', 'fr', {'targetLanguage': 'fr'}),
        throwsA(isA<IntentRecoveryRequired>()));
    expect(jsonEncode(await stored()), before);
    SyncStorage.intents = _FailingStore();
    var calls = 0;
    await http.runWithClient(() async {
      await expectLater(
          durableOnlineMutation('ai-send', 'en', send), throwsStateError);
    },
        () => MockClient((_) async {
              calls++;
              return http.Response('{"reply":"reply"}', 200);
            }));
    expect(calls, 0);
  });

  test(
      '9D protocol and language remain recorded; incompatible software pauses without relabeling',
      () async {
    final intent = await OnlineIntentService.prepare('ai-send', 'en', send);
    final snapshot = await stored();
    snapshot['intents'].single['protocol'] = 0;
    await SyncStorage.intents.write(owner, snapshot);
    var calls = 0;
    await http.runWithClient(() async {
      await recoverOnlineIntents('ai', language: 'de');
      expect(calls, 0);
      await expectLater(recoverOnlineIntents('ai', language: 'en'),
          throwsA(isA<TimelineRecoveryRequired>()));
    },
        () => MockClient((request) async {
              calls++;
              expect(request.headers['X-Client-Protocol'], '0');
              expect(request.headers['X-Idempotency-Key'], intent['id']);
              return http.Response(
                  '{"code":"CLIENT_PROTOCOL_UNSUPPORTED"}', 426);
            }));
    expect(calls, 0);
    expect((await stored())['intents'].single['id'], intent['id']);
    expect((await stored())['intents'].single['protocol'], 0);
  });
}

class _FailingStore implements SyncStorageBackend {
  @override
  bool get durable => true;
  @override
  Future<Map<String, dynamic>?> read(String owner) async => null;
  @override
  Future<void> write(String owner, Map<String, dynamic> value) async =>
      throw StateError('storage unavailable');
}

class _BrokenCache extends Fake implements SharedPreferences {
  final String owner;
  _BrokenCache(this.owner);
  @override
  Set<String> getKeys() => {CommunityQuery(owner, language: 'en').key};
  @override
  String? getString(String key) => jsonEncode({
        'schemaVersion': 2,
        'ownerNamespace': owner,
        'language': 'en',
        'page': 1,
        'limit': 50,
        'payload': {
          'page': 1,
          'limit': 50,
          'total': 0,
          'hasMore': false,
          'items': []
        }
      });
  @override
  Future<bool> remove(String key) async =>
      throw Exception('cache I/O unavailable');
}
