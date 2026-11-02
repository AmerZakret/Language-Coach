import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/data_timeline.dart';
import 'package:lingua_ai/services/online_intent_service.dart';
import 'package:lingua_ai/services/online_intent_dispatch.dart';
import 'package:lingua_ai/services/sync_storage.dart';
import 'package:lingua_ai/services/sync_storage_io.dart';
import 'data_timeline_test.dart'
    show timelineA, timelineB, userA, owner, compatibility;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory directory;
  FileSyncStorage store(
          {Future<void> Function()? beforePromote,
          Future<void> Function(RandomAccessFile, List<int>)? writeBytes,
          Future<void> Function()? beforeRename}) =>
      FileSyncStorage(() async => directory,
          beforePromote: beforePromote,
          writeBytes: writeBytes,
          beforeRename: beforeRename);
  File pending() => directory
      .listSync()
      .whereType<File>()
      .singleWhere((file) => file.path.endsWith('.pending'));
  Future<Map<String, String>> slots() async => {
        for (final file in directory
            .listSync()
            .whereType<File>()
            .where((file) => file.path.endsWith('.json')))
          file.path: await file.readAsString(),
      };
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    directory = await Directory.systemTemp.createTemp('lingua-promotion-');
    await AuthService().init();
    await AuthService().setGuestSession(
        id: userA, email: '$userA@guest.lingua.local', token: 'fixture');
    await store().write(owner, {
      'ownerNamespace': owner,
      'evidence': 'older-A',
      'dataTimelineId': timelineA
    });
    await store().write(owner, {
      'ownerNamespace': owner,
      'evidence': 'newest-A',
      'dataTimelineId': timelineA
    });
  });
  tearDown(() async {
    SyncStorage.backend = PreferencesSyncStorage();
    SyncStorage.intents =
        PreferencesSyncStorage(prefix: 'linguaai_online_intents_');
    if (directory.parent.absolute.path != Directory.systemTemp.absolute.path ||
        !directory.path
            .split(Platform.pathSeparator)
            .last
            .startsWith('lingua-promotion-')) {
      throw StateError('Unsafe fixture cleanup');
    }
    await directory.delete(recursive: true);
  });

  for (final failure in [
    'write failure',
    'partial pending',
    'invalid JSON',
    'bad checksum',
    'wrong generation',
    'wrong owner',
    'wrong schema',
    'after flush',
    'verified promotion failure'
  ]) {
    test('pending $failure preserves both previous verified slots', () async {
      final before = await slots();
      final failing = store(
        writeBytes: failure == 'write failure' || failure == 'partial pending'
            ? (handle, bytes) async {
                await handle.writeFrom(bytes.take(17).toList());
                if (failure == 'write failure') {
                  throw const FileSystemException('Injected write failure');
                }
              }
            : null,
        beforePromote: () async {
          if (failure == 'after flush') {
            throw const FileSystemException('Injected after flush');
          }
          if (failure == 'invalid JSON') {
            await pending().writeAsString('{invalid', flush: true);
          }
          if ([
            'bad checksum',
            'wrong generation',
            'wrong owner',
            'wrong schema'
          ].contains(failure)) {
            final record = jsonDecode(await pending().readAsString());
            if (failure == 'bad checksum') record['sha256'] = '0' * 64;
            if (failure == 'wrong generation') {
              record['body']['generation'] = 99;
            }
            if (failure == 'wrong owner') {
              record['body']['ownerNamespace'] = 'local_guest';
            }
            if (failure == 'wrong schema') record['body']['schemaVersion'] = 9;
            await pending().writeAsString(jsonEncode(record), flush: true);
          }
        },
        beforeRename: failure == 'verified promotion failure'
            ? () async {
                throw const FileSystemException('Injected promotion failure');
              }
            : null,
      );
      await expectLater(
          failing.write(owner, {
            'ownerNamespace': owner,
            'evidence': 'must not replace',
            'dataTimelineId': timelineB
          }),
          throwsA(
              anyOf(isA<FileSystemException>(), isA<SyncStorageCorruption>())));
      expect(await slots(), before);
      expect((await store().read(owner))!['evidence'], 'newest-A');
      // Reopen and a subsequent valid commit advances the last verified local
      // generation, rather than counting failed/unpromoted pending files.
      await store().write(owner, {
        'ownerNamespace': owner,
        'evidence': 'valid-B',
        'dataTimelineId': timelineB
      });
      final promoted = jsonDecode(
          await File('${directory.path}/$owner.1.json').readAsString());
      expect(promoted['body']['generation'], 3);
      expect(promoted['body']['payload']['dataTimelineId'], timelineB);
    });
  }

  test(
      'bad pending checksum prevents dependent HTTP and preserves old intent evidence',
      () async {
    final intentsDirectory = Directory('${directory.path}/intents');
    SyncStorage.intents = FileSyncStorage(() async => intentsDirectory);
    await OnlineIntentService.prepare(
        'ai-clear', 'en', {'targetLanguage': 'en'});
    final before = await SyncStorage.intents.read(owner);
    SyncStorage.intents =
        FileSyncStorage(() async => intentsDirectory, beforePromote: () async {
      final file = intentsDirectory
          .listSync()
          .whereType<File>()
          .singleWhere((file) => file.path.endsWith('.pending'));
      final value = jsonDecode(await file.readAsString());
      value['sha256'] = '0' * 64;
      await file.writeAsString(jsonEncode(value), flush: true);
    });
    var requests = 0;
    await http.runWithClient(() async {
      await expectLater(
          durableOnlineMutation('ai-send', 'de',
              {'message': 'hello', 'language': 'en', 'targetLanguage': 'de'}),
          throwsA(isA<SyncStorageCorruption>()));
    },
        () => MockClient((_) async {
              requests++;
              return http.Response('{}', 200);
            }));
    expect(requests, 0);
    expect(await FileSyncStorage(() async => intentsDirectory).read(owner),
        before);
  });

  test(
      'valid JSON corrupt newest checksum exposes A backup and never dispatches it on B',
      () async {
    final intentsDirectory = Directory('${directory.path}/intents');
    SyncStorage.intents = FileSyncStorage(() async => intentsDirectory);
    final clear = await OnlineIntentService.prepare(
        'ai-clear', 'en', {'targetLanguage': 'en'});
    final journal = (await SyncStorage.intents.read(owner))!;
    await SyncStorage.intents.write(owner, journal);
    final newest = File('${intentsDirectory.path}/$owner.0.json');
    final value = jsonDecode(await newest.readAsString());
    value['sha256'] = '0' * 64;
    await newest.writeAsString(jsonEncode(value), flush: true);
    final corruptBytes = await newest.readAsBytes();
    await DataTimeline().discover(
        fetch: () async =>
            http.Response(jsonEncode(compatibility(timelineB)), 200));
    SyncStorage.intents = FileSyncStorage(() async => intentsDirectory);
    await expectLater(
        OnlineIntentService.list(),
        throwsA(isA<SyncStorageCorruption>().having(
            (error) => error.previousValid!['intents'].single['dataTimelineId'],
            'backup timeline',
            timelineA)));
    var sends = 0;
    await http.runWithClient(() async {
      await expectLater(replayOnlineIntent(clear['id']),
          throwsA(isA<SyncStorageCorruption>()));
    },
        () => MockClient((_) async {
              sends++;
              return http.Response('{}', 200);
            }));
    expect(sends, 0);
    expect(await newest.readAsBytes(), corruptBytes);
  });
}
