import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/api_response.dart';
import 'package:lingua_ai/services/community_feed_cache.dart';
import 'package:lingua_ai/services/community_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const a = '507f1f77bcf86cd799439011', b = '507f1f77bcf86cd799439012';
  final auth = AuthService(), service = CommunityService();
  late SharedPreferences prefs;
  Map<String, dynamic> post(String id, [String text = 'personalized']) => {
        '_id': 'post',
        'userId': id,
        'userName': id,
        'learningLanguage': 'en',
        'text': text,
        'likes': [id],
        'likesCount': 1,
        'likedByMe': true,
        'createdAt': '',
        'updatedAt': '',
      };
  Map<String, dynamic> feed(String id) => {
        'items': [post(id)],
        'page': 1,
        'limit': 50,
        'total': 1,
        'hasMore': false
      };
  Future<void> login(String id) async {
    auth.setBackendSession(
        id: id, name: id, email: '$id@example.test', token: 'token-$id');
    for (var i = 0; i < 20; i++) {
      await Future<void>.value();
    }
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await auth.init();
    prefs = await SharedPreferences.getInstance();
    await login(a);
  });

  test(
      'registered/guest/local_guest cache isolation, canonical queries and switch back',
      () async {
    final query = CommunityQuery('registered_$a', language: 'English');
    await CommunityFeedCache.write(prefs, query, feed(a));
    for (final owner in ['registered_$b', 'guest_$a', 'local_guest']) {
      expect(
          CommunityFeedCache.read(prefs, CommunityQuery(owner, language: 'en')),
          isNull);
    }
    await login(b);
    expect(
        CommunityFeedCache.read(
            prefs, CommunityQuery(auth.localStorageNamespace, language: 'en')),
        isNull);
    await auth.setGuestSession(
        token: 'guest', id: b, email: '$b@guest.lingua.local');
    expect(
        CommunityFeedCache.read(
            prefs, CommunityQuery(auth.localStorageNamespace, language: 'en')),
        isNull);
    await auth.loginAsGuest();
    expect(
        CommunityFeedCache.read(
            prefs, CommunityQuery(auth.localStorageNamespace, language: 'en')),
        isNull);
    await login(a);
    expect(
        CommunityFeedCache.read(
            prefs, CommunityQuery(auth.localStorageNamespace, language: 'en')),
        feed(a));
    for (final other in [
      CommunityQuery('registered_$a', language: 'de'),
      CommunityQuery('registered_$a', language: 'en', page: 2),
      CommunityQuery('registered_$a', language: 'en', limit: 10)
    ]) {
      expect(CommunityFeedCache.read(prefs, other), isNull);
    }
  });

  test(
      'legacy, owner/envelope/query mismatch and malformed cache remain unavailable',
      () async {
    final query = CommunityQuery('registered_$a');
    await prefs.setString('community_posts_All', jsonEncode(feed(a)));
    expect(CommunityFeedCache.read(prefs, query), isNull);
    await CommunityFeedCache.write(prefs, query, feed(a));
    final valid = jsonDecode(prefs.getString(query.key)!);
    for (final change in [
      {'ownerNamespace': 'registered_$b'},
      {'schemaVersion': 1},
      {'language': 'de'},
      {'page': 2},
      {'limit': 10},
      {'payload': {}},
      {
        'payload': {
          ...feed(a),
          'items': [null]
        }
      }
    ]) {
      await prefs.setString(query.key, jsonEncode({...valid, ...change}));
      expect(CommunityFeedCache.read(prefs, query), isNull);
    }
    await prefs.setString(query.key, '{broken');
    expect(CommunityFeedCache.read(prefs, query), isNull);
    await CommunityFeedCache.write(
        prefs, query, {...feed(a), 'items': [], 'total': 0});
    expect(CommunityFeedCache.read(prefs, query)!['items'], isEmpty);
  });

  test('late owner/query response cannot populate cache', () async {
    for (final boundary in ['owner', 'query']) {
      await login(a);
      final pending = Completer<http.Response>();
      var current = true;
      await http.runWithClient(() async {
        final work =
            service.fetchPosts(language: 'English', isCurrent: () => current);
        final assertion = expectLater(work, throwsStateError);
        if (boundary == 'owner') {
          await login(b);
        } else {
          current = false;
        }
        pending.complete(http.Response(jsonEncode(feed(a)), 200));
        await assertion;
        expect(
            CommunityFeedCache.read(
                prefs, CommunityQuery('registered_$a', language: 'en')),
            isNull);
        expect(
            CommunityFeedCache.read(
                prefs, CommunityQuery('registered_$b', language: 'en')),
            isNull);
      }, () => MockClient((_) => pending.future));
    }
  });

  for (final failure in ['network', '401', 'server', 'malformed']) {
    test('$failure follows exact fallback policy', () async {
      final query = CommunityQuery('registered_$a');
      await CommunityFeedCache.write(prefs, query, feed(a));
      await http.runWithClient(() async {
        if (failure == 'network') {
          expect((await service.fetchPosts()).single.likedByMe, true);
        } else {
          await expectLater(service.fetchPosts(), throwsA(anything));
        }
        if (failure == '401') {
          expect(auth.token, isEmpty);
        }
        expect(CommunityFeedCache.read(prefs, query), isNotNull,
            reason: 'auth failure never relabels/deletes own cache');
      },
          () => MockClient((_) async {
                if (failure == 'network') {
                  throw http.ClientException('offline');
                }
                return http.Response(
                    '{}',
                    failure == '401'
                        ? 401
                        : failure == 'server'
                            ? 503
                            : 200);
              }));
    });
  }

  test('local_guest never dispatches Community or adopts backend cache',
      () async {
    await CommunityFeedCache.write(
        prefs, CommunityQuery('registered_$a'), feed(a));
    await auth.loginAsGuest();
    var calls = 0;
    await http.runWithClient(() async {
      await expectLater(service.fetchPosts(), throwsA(isA<ApiException>()));
      await expectLater(
          service.createPost(learningLanguage: 'en', text: 'draft'),
          throwsA(isA<ApiException>()));
      expect(calls, 0);
    },
        () => MockClient((_) async {
              calls++;
              return http.Response(jsonEncode(feed(a)), 200);
            }));
  });

  for (final operation in ['create', 'edit', 'delete', 'like']) {
    test('$operation invalidates only current-owner affected caches', () async {
      final affected = CommunityQuery('registered_$a', language: 'en'),
          all = CommunityQuery('registered_$a');
      final unrelated = CommunityQuery('registered_$a', language: 'de'),
          other = CommunityQuery('registered_$b', language: 'en');
      for (final query in [affected, all, other]) {
        await CommunityFeedCache.write(prefs, query, feed(a));
      }
      await CommunityFeedCache.write(prefs, unrelated, {
        ...feed(a),
        'items': [
          {...post(a), '_id': 'unrelated'}
        ]
      });
      await http.runWithClient(() async {
        switch (operation) {
          case 'create':
            await service.createPost(learningLanguage: 'en', text: 'new');
          case 'edit':
            await service.updatePost(postId: 'post', text: 'edit');
          case 'delete':
            await service.deletePost(postId: 'post');
          case 'like':
            await service.toggleLike(postId: 'post');
        }
        expect(CommunityFeedCache.read(prefs, affected), isNull);
        expect(CommunityFeedCache.read(prefs, all), isNull);
        expect(CommunityFeedCache.read(prefs, unrelated), isNotNull);
        expect(CommunityFeedCache.read(prefs, other), isNotNull);
      },
          () => MockClient((_) async => http.Response(
              jsonEncode(operation == 'like'
                  ? {'likesCount': 2, 'likedByMe': false}
                  : operation == 'delete'
                      ? {'success': true}
                      : post(a)),
              200)));
    });
  }

  test('old draft session cannot silently submit with replacement token',
      () async {
    final old = auth.captureSession();
    await login(b);
    var calls = 0;
    await http.runWithClient(() async {
      await expectLater(
          service.createPost(
              learningLanguage: 'en', text: 'A draft', expectedSession: old),
          throwsStateError);
      expect(calls, 0);
    },
        () => MockClient((_) async {
              calls++;
              return http.Response(jsonEncode(post(b)), 201);
            }));
  });
}
