import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_api_service.dart';
import 'package:lingua_ai/services/offline_queue_service.dart';
import 'package:lingua_ai/services/progress_api_service.dart';

// Flutter's test binding blocks HTTP by default; allow only this loopback fixture.
class ContractHttpOverrides extends HttpOverrides {}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('Flutter direct and queued reset reach the real Nest route contract',
      () async {
    final server = await Process.start(
        'node', ['test/progress-reset-server.cjs'],
        workingDirectory: '../lingua_ai_backend');
    final stderr = <String>[];
    final errors = server.stderr.transform(utf8.decoder).listen(stderr.add);
    try {
      final line = await server.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .first
          .timeout(const Duration(seconds: 30));
      final fixture = jsonDecode(line) as Map<String, dynamic>;
      final owner = fixture['owner'] as String;
      final base = Uri.parse(fixture['url'] as String);
      SharedPreferences.setMockInitialValues({});
      final auth = AuthService();
      await auth.init();
      await auth.setGuestSession(
          id: owner,
          email: 'guest-route@guest.lingua.local',
          token: fixture['token'] as String);
      await HttpOverrides.runWithHttpOverrides(() async {
        final wire = http.Client();
        final requests = <http.Request>[];
        try {
          await http.runWithClient(() async {
            final api = ProgressApiService();
            await api.resetProgress(owner,
                expectedEpoch: 0, operationId: 'direct-reset');
            final queue = OfflineQueueService.forTesting(
                progressApi: api, flashcardApi: FlashcardApiService());
            await queue.pushAction('reset-progress', {'expectedEpoch': 1},
                ownerNamespace: auth.localStorageNamespace);
            final id = (await queue.getQueue()).single.id;
            expect(await queue.processQueue(owner), true);
            expect(await queue.getQueue(), isEmpty);
            expect(await queue.getFailedActions(), isEmpty);
            expect(requests.map((r) => r.url.path),
                ['/progress/$owner', '/progress/$owner']);
            expect(requests.map((r) => r.headers['X-Idempotency-Key']),
                ['direct-reset', id]);
          },
              () => MockClient((request) async {
                    requests.add(request);
                    // Keep the actual client's method/path/headers; change only origin.
                    final forwarded = http.Request(
                        request.method, base.resolve(request.url.path));
                    forwarded.headers.addAll(request.headers);
                    forwarded.body = request.body;
                    final response = await http.Response.fromStream(
                        await wire.send(forwarded));
                    expect(response.statusCode, 200);
                    expect(jsonDecode(response.body)['userId'], owner);
                    return response;
                  }));
          final snapshot =
              await wire.get(base.resolve('/progress/$owner'), headers: {
            'Authorization': 'Bearer ${fixture['token']}',
          });
          expect(jsonDecode(snapshot.body)['resets'], [owner, owner]);
        } finally {
          wire.close();
        }
      }, ContractHttpOverrides());
    } finally {
      await server.stdin.close();
      try {
        await server.exitCode.timeout(const Duration(seconds: 5));
      } on TimeoutException {
        server.kill();
        await server.exitCode;
      }
      await errors.cancel();
    }
    expect(stderr, isEmpty);
  }, timeout: const Timeout(Duration(seconds: 60)));
}
