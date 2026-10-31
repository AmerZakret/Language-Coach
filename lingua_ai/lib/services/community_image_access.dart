import '../core/config/api_config.dart';

/// Never attach an account bearer to a foreign origin or unrelated endpoint.
Map<String, String> communityImageHeaders(String reference, String token) {
  final uri = Uri.tryParse(reference);
  final base = Uri.parse(ApiConfig.baseUrl);
  if (token.isEmpty ||
      uri == null ||
      uri.userInfo.isNotEmpty ||
      !uri.hasAuthority ||
      uri.origin != base.origin ||
      uri.hasQuery ||
      uri.hasFragment ||
      !RegExp(r'^/uploads/community/[a-zA-Z0-9.-]+$').hasMatch(uri.path)) {
    return const {};
  }
  return {'Authorization': 'Bearer $token'};
}
