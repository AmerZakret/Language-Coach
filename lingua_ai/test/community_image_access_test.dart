import 'package:flutter_test/flutter_test.dart';
import 'package:lingua_ai/core/config/api_config.dart';
import 'package:lingua_ai/services/community_image_access.dart';

void main() {
  test('community images authenticate only the configured API image route', () {
    const token = 'synthetic-session';
    final url = '${ApiConfig.baseUrl}/uploads/community/fixture.png';
    expect(communityImageHeaders(url, token), {
      'Authorization': 'Bearer $token',
    });
    expect(communityImageHeaders(url, ''), isEmpty);
    for (final target in [
      'https://foreign.example/uploads/community/fixture.png',
      '${ApiConfig.baseUrl}/auth/login',
      '$url?token=never',
      '${ApiConfig.baseUrl}/uploads/community/../secret',
      '${ApiConfig.baseUrl}/uploads/community/a/b.png',
    ]) {
      expect(communityImageHeaders(target, token), isEmpty);
    }
  });
}
