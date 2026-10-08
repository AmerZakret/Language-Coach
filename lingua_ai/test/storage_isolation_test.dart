import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';
import 'package:lingua_ai/services/flashcard_service.dart';
import 'package:lingua_ai/services/progress_service.dart';
import 'package:lingua_ai/services/progress_cache.dart';
import 'package:lingua_ai/services/progress_epoch.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const idA = '507f1f77bcf86cd799439011';
  const idB = '507f1f77bcf86cd799439012';

  test(
      'progress and cards isolate backend guests, restoration, and local guests',
      () async {
    SharedPreferences.setMockInitialValues({
      'progress_guest_en_totalXp': 999,
      'flashcards_guest_en_list': '[{"targetWord":"shared legacy card"}]',
    });
    final auth = AuthService();
    final progress = ProgressService();
    final cards = FlashcardService();
    await auth.init();
    await auth.setGuestSession(
        id: idA, email: 'guest-a@guest.lingua.local', token: 'token-a');
    await progress.init();
    await cards.init();
    final prefs = await SharedPreferences.getInstance();
    // Known server epoch in this fixture, independent of displayed XP caches.
    for (final owner in ['guest_$idA', 'guest_$idB', 'registered_$idA']) {
      await ProgressEpoch.acknowledge(prefs, owner, 0);
    }

    Future<void> writeData(int xp, String word) async {
      // Seed acknowledged progress; activities cannot award client-only XP.
      await ProgressSnapshot(totalXp: xp, streak: 0, lessonIds: {}, activity: [])
          .save(prefs, auth.localStorageNamespace, 'en');
      await progress.reloadProgress();
      await cards.createFlashcard(word, 'translation');
      // The services' local write helpers finish asynchronously.
      await Future<void>.delayed(Duration.zero);
    }

    expect(auth.isLoggedIn, false,
        reason: 'Backend guests must not need the member flag');
    expect(auth.localStorageNamespace, 'guest_$idA');
    expect(progress.totalXp, 0);
    expect(cards.allCards, isEmpty);
    await writeData(10, 'Guest A word');
    expect(ProgressSnapshot.read(prefs, 'guest_$idA', 'en').totalXp, 10);
    expect(
        jsonDecode(prefs.getString('flashcards_guest_${idA}_en_list')!)[0]
            ['targetWord'],
        'Guest A word');
    final persistedA = {
      for (final key in [
        'isLoggedIn',
        'isGuest',
        'currentUserName',
        'currentUserEmail',
        'currentUserId',
        'token'
      ])
        key: prefs.get(key)!,
    };
    final namespaceA = auth.localStorageNamespace;

    auth.logout();
    await auth.setGuestSession(
        id: idB, email: 'guest-b@guest.lingua.local', token: 'token-b');
    expect(auth.localStorageNamespace, 'guest_$idB');
    expect(auth.localStorageNamespace, isNot(namespaceA));
    expect(progress.totalXp, 0);
    expect(cards.allCards, isEmpty);
    await writeData(20, 'Guest B word');
    expect(ProgressSnapshot.read(prefs, 'guest_$idB', 'en').totalXp, 20);
    expect(
        jsonDecode(prefs.getString('flashcards_guest_${idB}_en_list')!)[0]
            ['targetWord'],
        'Guest B word');
    expect(ProgressSnapshot.read(prefs, 'guest_$idA', 'en').totalXp, 10);

    await auth.loginAsGuest();
    expect(auth.localStorageNamespace, 'local_guest');
    expect(progress.totalXp, 0);
    expect(cards.allCards, isEmpty);
    await writeData(30, 'Offline word');
    expect(ProgressSnapshot.read(prefs, 'local_guest', 'en').totalXp, 30);
    expect(prefs.getString('flashcards_local_guest_en_list'), isNotNull);

    // Restore the saved session through init(), as on restart, without using
    // setGuestSession. Keep all three namespaces' data on the same device.
    for (final entry in persistedA.entries) {
      if (entry.value is bool) {
        await prefs.setBool(entry.key, entry.value as bool);
      } else {
        await prefs.setString(entry.key, entry.value as String);
      }
    }
    await auth.init();
    expect(auth.localStorageNamespace, namespaceA);
    await progress.reloadProgress();
    expect(progress.totalXp, 10);
    expect(cards.allCards.single.targetWord, 'Guest A word');

    await auth.setGuestSession(
        id: idB, email: 'guest-b@guest.lingua.local', token: 'token-b');
    await progress.reloadProgress();
    expect(progress.totalXp, 20);
    expect(cards.allCards.single.targetWord, 'Guest B word');
    await auth.loginAsGuest();
    await progress.reloadProgress();
    expect(progress.totalXp, 30);
    expect(cards.allCards.single.targetWord, 'Offline word');

    // Session switches between preference writes must not redirect the rest of
    // a save or reset into the next guest's keys.
    final baseB = ProgressSnapshot.read(prefs, 'guest_$idB', 'en');
    await ProgressSnapshot(
            totalXp: baseB.totalXp,
            streak: 7,
            lessonIds: baseB.lessonIds,
            activity: baseB.activity)
        .save(prefs, 'guest_$idB', 'en');
    await prefs.setInt('progress_guest_${idB}_en_streak', 7);
    await auth.setGuestSession(
        id: idA, email: 'guest-a@guest.lingua.local', token: 'token-a');
    final reloadingA = progress.reloadProgress();
    await auth.setGuestSession(
        id: idB, email: 'guest-b@guest.lingua.local', token: 'token-b');
    await reloadingA;
    await progress.reloadProgress();
    expect(progress.streak, 7);
    expect(prefs.getInt('progress_guest_${idB}_en_streak'), 7);
    await auth.setGuestSession(
        id: idA, email: 'guest-a@guest.lingua.local', token: 'token-a');
    final resettingA = progress.resetProgress();
    await auth.setGuestSession(
        id: idB, email: 'guest-b@guest.lingua.local', token: 'token-b');
    await resettingA;
    await progress.reloadProgress();
    expect(progress.totalXp, 20);
    expect(progress.streak, 7);
    expect(prefs.getInt('progress_guest_${idB}_en_streak'), 7);

    await HttpOverrides.runZoned(() async {
      // Attributable registered email caches migrate; resets never revive them.
      await prefs.setInt('progress_member_example_com_en_totalXp', 40);
      await prefs.setInt('progress_member_example_com_en_streak', 2);
      await prefs.setStringList(
          'progress_member_example_com_en_completedLessonIds',
          ['member-lesson']);
      await prefs.setStringList(
          'progress_member_example_com_en_weeklyActivity', ['0.4']);
      await prefs.setString('flashcards_member_example_com_en_list',
          prefs.getString('flashcards_guest_${idA}_en_list')!);
      await prefs.setBool('isGuest', false);
      await prefs.setBool('isLoggedIn', true);
      await prefs.setString('currentUserId', idA);
      await prefs.setString('currentUserEmail', 'member@example.com');
      await prefs.setString('token', '');
      await auth.init();
      await progress.reloadProgress();
      await cards.reloadFlashcards();
      await Future<void>.delayed(Duration.zero);
      expect(progress.totalXp, 40);
      expect(progress.streak, 2);
      expect(progress.completedLessonIds, {'member-lesson'});
      expect(progress.weeklyActivity, [0.4]);
      expect(cards.allCards.single.targetWord, 'Guest A word');
      expect(
          prefs.getString('flashcards_registered_${idA}_en_list'), isNotNull);
      expect(prefs.containsKey('flashcards_member_example_com_en_list'), false);
      expect(
          prefs.containsKey('progress_member_example_com_en_totalXp'), false);
      expect(ProgressSnapshot.read(prefs, 'guest_$idB', 'en').totalXp, 20);
      await progress.resetProgress();
      await progress.reloadProgress();
      expect(progress.totalXp, 0);
      await Future<void>.delayed(Duration.zero);
    },
        createHttpClient: (_) =>
            throw StateError('Offline test: network disabled'));
    progress.dispose();
    cards.dispose();
  });

  test('registered namespaces depend on ID rather than email', () async {
    SharedPreferences.setMockInitialValues({});
    final auth = AuthService();
    await auth.init();
    auth.setBackendSession(
        name: 'Member',
        email: 'first@example.com',
        token: 'member-token',
        id: idA);
    await Future<void>.delayed(Duration.zero);
    final namespace = auth.localStorageNamespace;
    expect(namespace, 'registered_$idA');
    expect(namespace, isNot('guest_$idA'));
    auth.setBackendSession(
        name: 'Member',
        email: 'changed@example.com',
        token: 'member-token',
        id: idA);
    await Future<void>.delayed(Duration.zero);
    expect(auth.localStorageNamespace, namespace);
  });
}
