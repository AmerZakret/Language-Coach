import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:lingua_ai/core/config/api_config.dart';

void main() {
  for (final endpoint in [
    '',
    'http://localhost:3000',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://10.0.2.2',
    'https://192.168.1.102',
    'https://172.16.0.1',
    'https://api.local',
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://[0:0:0:0:0:0:0:1]',
    'https://[::ffff:127.0.0.1]',
    'http://api.example.invalid',
    'https://user:password@api.example.invalid'
  ]) {
    test('release rejects unsafe backend endpoint $endpoint', () {
      expect(() => ApiConfig.validateEndpoint(endpoint, release: true),
          throwsStateError);
    });
  }
  test('debug local endpoints remain usable', () {
    expect(ApiConfig.validateEndpoint('http://localhost:3000', release: false),
        'http://localhost:3000');
    expect(ApiConfig.baseUrl, isNotEmpty);
  });
  test('release accepts explicit HTTPS endpoint', () {
    expect(
        ApiConfig.validateEndpoint('https://api.example.invalid/',
            release: true),
        'https://api.example.invalid');
  });
  test('startup validates release configuration before services start', () {
    final source = File('lib/main.dart').readAsStringSync();
    expect(source.indexOf('ApiConfig.validateReleaseConfiguration();'),
        lessThan(source.indexOf('await ConnectivityService().init()')));
  });
  test('Android main manifest grants Internet and iOS explains microphone use',
      () {
    expect(File('android/app/src/main/AndroidManifest.xml').readAsStringSync(),
        contains('android.permission.INTERNET'));
    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    expect(
        RegExp(r'<key>NSMicrophoneUsageDescription</key>\s*<string>[^<]+</string>')
            .hasMatch(plist),
        isTrue);
  });
  test('release signing has operator hooks and no debug signing fallback', () {
    final gradle = File('android/app/build.gradle.kts').readAsStringSync();
    expect(gradle, contains('key.properties'));
    expect(gradle, contains('Release signing requires'));
    expect(gradle, isNot(contains('signingConfigs.getByName("debug")')));
  });
}
