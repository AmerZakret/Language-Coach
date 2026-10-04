import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:lingua_ai/services/auth_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const id = '507f1f77bcf86cd799439011';
  const email = 'guest-test-session@guest.lingua.local';
  const token = 'test-only-guest-token';

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await AuthService().init();
  });

  test('persists and restores the backend guest identity and token', () async {
    final auth = AuthService();
    await auth.setGuestSession(id: id, email: email, token: token);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('currentUserId'), id);
    expect(prefs.getString('currentUserEmail'), email);
    expect(prefs.getString('token'), token);
    expect(prefs.getBool('isGuest'), true);

    final persisted = {
      for (final key in prefs.getKeys()) key: prefs.get(key)!,
    };
    await auth.loginAsGuest();
    SharedPreferences.setMockInitialValues(persisted);
    await auth.init();
    expect(auth.currentUserId, id);
    expect(auth.currentUserEmail, email);
    expect(auth.token, token);
    expect(auth.isGuest, true);
  });

  test('a new backend session keeps its own distinct identity', () async {
    final auth = AuthService();
    await auth.setGuestSession(id: id, email: email, token: token);
    auth.logout();
    const nextId = '507f1f77bcf86cd799439012';
    await auth.setGuestSession(id: nextId,
      email: 'guest-next-session@guest.lingua.local', token: 'next-test-token');
    await auth.init();
    expect(auth.currentUserId, nextId);
    expect(auth.currentUserId, isNot(id));
  });

  test('offline guest mode persists no backend token', () async {
    final auth = AuthService();
    await auth.loginAsGuest();
    await auth.init();
    expect(auth.currentUserId, 'guest');
    expect(auth.token, isEmpty);
    expect(auth.isGuest, true);
  });

  test('rejects a backend token paired with the local guest identifier', () async {
    final auth = AuthService();
    await expectLater(auth.setGuestSession(id: 'guest', email: email, token: token),
      throwsArgumentError);
    expect(auth.token, isEmpty);
  });

  test('legacy shared guest state loses backend authorization on restoration', () async {
    SharedPreferences.setMockInitialValues({
      'isGuest': true,
      'currentUserId': id,
      'currentUserEmail': 'guest@lingua.ai',
      'token': token,
    });
    final auth = AuthService();
    await auth.init();
    expect(auth.isGuest, true);
    expect(auth.currentUserId, 'guest');
    expect(auth.token, isEmpty);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('token'), isEmpty);
  });
}
