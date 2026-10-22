import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/localization/target_language.dart';

class CommunityQuery {
  final String ownerNamespace;
  final String language;
  final int page;
  final int limit;
  CommunityQuery(this.ownerNamespace,
      {String? language, this.page = 1, this.limit = 50})
      : language = language == null || language.toLowerCase() == 'all'
            ? 'All'
            : TargetLanguage.code(language) {
    if (!RegExp(r'^(registered_[a-f\d]{24}|guest_[a-f\d]{24}|local_guest)$',
                caseSensitive: false)
            .hasMatch(ownerNamespace) ||
        page < 1 ||
        limit < 1) {
      throw const FormatException('Invalid Community query');
    }
  }
  String get key =>
      'community_feed_v2_${Uri.encodeComponent(ownerNamespace)}_${language}_${page}_$limit';
}

class CommunityFeedCache {
  static bool validPayload(dynamic data, CommunityQuery query) =>
      data is Map<String, dynamic> &&
      data['page'] == query.page &&
      data['limit'] == query.limit &&
      data['total'] is int &&
      data['total'] >= 0 &&
      data['hasMore'] is bool &&
      data['items'] is List &&
      (data['items'] as List).every((post) =>
          post is Map<String, dynamic> &&
          post['_id'] is String &&
          (post['_id'] as String).isNotEmpty &&
          post['userId'] is String &&
          post['userName'] is String &&
          post['learningLanguage'] is String &&
          post['likes'] is List &&
          (post['likes'] as List).every((id) => id is String) &&
          post['likesCount'] is int &&
          post['likesCount'] >= 0 &&
          post['likedByMe'] is bool &&
          post['createdAt'] is String &&
          post['updatedAt'] is String &&
          (post['text'] == null || post['text'] is String) &&
          (post['imageUrl'] == null || post['imageUrl'] is String));

  // Legacy community_posts_<language> has no attributable owner. Ignore it;
  // retain other owners' valid v2 entries across logout/account switches.
  static Map<String, dynamic>? read(
      SharedPreferences prefs, CommunityQuery query) {
    try {
      final raw = prefs.getString(query.key);
      if (raw == null) return null;
      final entry = jsonDecode(raw);
      if (entry is! Map ||
          entry['schemaVersion'] != 2 ||
          entry['ownerNamespace'] != query.ownerNamespace ||
          entry['language'] != query.language ||
          entry['page'] != query.page ||
          entry['limit'] != query.limit ||
          !validPayload(entry['payload'], query)) {
        return null;
      }
      return entry['payload'] as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  static Future<void> write(SharedPreferences prefs, CommunityQuery query,
      Map<String, dynamic> payload) async {
    if (!validPayload(payload, query)) {
      throw const FormatException('Malformed Community feed');
    }
    try {
      await prefs.setString(
          query.key,
          jsonEncode({
            'schemaVersion': 2,
            'ownerNamespace': query.ownerNamespace,
            'language': query.language,
            'page': query.page,
            'limit': query.limit,
            'payload': payload
          }));
    } catch (_) {/* A cache failure must not reject a valid online feed. */}
  }

  static Future<void> invalidate(SharedPreferences prefs, String owner,
      {String? postId, String? language, bool Function()? isCurrent}) async {
    final prefix = 'community_feed_v2_${Uri.encodeComponent(owner)}_';
    final code = language == null ? null : TargetLanguage.code(language);
    for (final key in prefs.getKeys().where((key) => key.startsWith(prefix))) {
      try {
        final entry = jsonDecode(prefs.getString(key)!);
        final query = CommunityQuery(owner,
            language: entry['language'],
            page: entry['page'],
            limit: entry['limit']);
        final feed = read(prefs, query);
        if (feed != null &&
            key == query.key &&
            ((code != null &&
                    (query.language == 'All' || query.language == code)) ||
                (postId != null &&
                    (feed['items'] as List)
                        .any((post) => post['_id'] == postId)))) {
          if (isCurrent?.call() == false) return;
          await prefs.remove(key);
        }
      } catch (_) {/* Malformed entries are unavailable, never re-owned. */}
    }
  }
}
