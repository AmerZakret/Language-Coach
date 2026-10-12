import '../core/localization/target_language.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/config/api_config.dart';
import '../models/community_post.dart';
import 'auth_service.dart';
import 'api_response.dart';
import 'connectivity_service.dart';
import 'community_feed_cache.dart';

class CommunityService {
  static final Map<String, int> _feedVersions = {};
  void _requireSession(SessionSnapshot session, [bool Function()? isCurrent]) {
    if (!session.isCurrent || (isCurrent != null && !isCurrent())) {
      throw StateError('Community session or query changed');
    }
    if (session.ownerNamespace == 'local_guest' || AuthService().token.isEmpty) {
      throw const ApiException(ApiFailure.client, 'Sign in to use Community.');
    }
  }

  Future<void> _invalidate(SessionSnapshot session, {String? postId, String? language}) async {
    _feedVersions[session.ownerNamespace] = (_feedVersions[session.ownerNamespace] ?? 0) + 1;
    final prefs = await SharedPreferences.getInstance();
    if (!session.isCurrent) return;
    await CommunityFeedCache.invalidate(prefs, session.ownerNamespace, postId: postId, language: language);
  }

  Future<List<CommunityPost>> fetchPosts({String? language, int page = 1, int limit = 50, bool Function()? isCurrent}) async {
    final session = AuthService().captureSession();
    final version = _feedVersions[session.ownerNamespace] ?? 0;
    final viewCurrent = isCurrent;
    isCurrent = () => (viewCurrent == null || viewCurrent()) && version == (_feedVersions[session.ownerNamespace] ?? 0);
    _requireSession(session, isCurrent);
    final query = CommunityQuery(session.ownerNamespace, language: language, page: page, limit: limit);
    final token = AuthService().token;
    try {
      if (ConnectivityService().isOffline) {
        throw const ApiException(ApiFailure.network, 'Device is offline');
      }
      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.communityPosts}').replace(queryParameters: {
        'page': '$page', 'limit': '$limit', if (query.language != 'All') 'language': query.language,
      });
      final response = await apiRequest(() {
        _requireSession(session, isCurrent);
        return http.get(uri, headers: {'Authorization': 'Bearer $token'});
      }, session);
      _requireSession(session, isCurrent);
      final decoded = jsonDecode(response.body);
      if (!CommunityFeedCache.validPayload(decoded, query)) throw const FormatException('Malformed Community feed');
      final prefs = await SharedPreferences.getInstance();
      _requireSession(session, isCurrent);
      await CommunityFeedCache.write(prefs, query, decoded as Map<String, dynamic>);
      _requireSession(session, isCurrent);
      return (decoded['items'] as List).map((item) => CommunityPost.fromJson(item)).toList();
    } catch (error) {
      // Only a current owner's network/offline failure permits cache fallback.
      // Unauthorized, server, client and malformed responses remain failures.
      if (error is! ApiException || error.kind != ApiFailure.network) rethrow;
      final prefs = await SharedPreferences.getInstance();
      _requireSession(session, isCurrent);
      final cached = CommunityFeedCache.read(prefs, query);
      if (cached == null) rethrow;
      return (cached['items'] as List).map((item) => CommunityPost.fromJson(item)).toList();
    }
  }

  Future<CommunityPost> createPost({
    required String learningLanguage,
    String? text,
    String? imagePath,
    SessionSnapshot? expectedSession,
  }) async {
    try {
      final session = expectedSession ?? AuthService().captureSession();
      _requireSession(session);
      final token = AuthService().token;
      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.communityPosts}');
      final request = http.MultipartRequest('POST', uri);

      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }

      request.fields['learningLanguage'] = TargetLanguage.code(learningLanguage);
      if (text != null && text.trim().isNotEmpty) {
        request.fields['text'] = text.trim();
      }

      if (imagePath != null && imagePath.isNotEmpty) {
        if (kIsWeb) {
          final response = await http.get(Uri.parse(imagePath));
          final multipartFile = http.MultipartFile.fromBytes(
            'image',
            response.bodyBytes,
            filename: 'image.${_getFileExtension(imagePath)}',
            contentType: MediaType('image', _getFileExtension(imagePath)),
          );
          request.files.add(multipartFile);
        } else {
          final file = File(imagePath);
          if (await file.exists()) {
            final multipartFile = await http.MultipartFile.fromPath(
              'image',
              imagePath,
              contentType: MediaType('image', _getFileExtension(imagePath)),
            );
            request.files.add(multipartFile);
          }
        }
      }

      final response = await apiRequest(
          () async {
            _requireSession(session);
            return http.Response.fromStream(await request.send());
          }, session);

      if (response.statusCode == 200 || response.statusCode == 201) {
        _requireSession(session);
        final decoded = json.decode(response.body);
        final post = CommunityPost.fromJson(decoded);
        await _invalidate(session, postId: post.id, language: post.learningLanguage);
        _requireSession(session);
        return post;
      } else {
        throw Exception(response.body);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<CommunityPost> updatePost({
    required String postId,
    String? text,
    bool? removeImage,
    String? newImagePath,
    SessionSnapshot? expectedSession,
  }) async {
    try {
      final session = expectedSession ?? AuthService().captureSession();
      _requireSession(session);
      final token = AuthService().token;
      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.communityPosts}/$postId');
      final request = http.MultipartRequest('PUT', uri);

      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }

      if (text != null) {
        request.fields['text'] = text.trim();
      }
      if (removeImage != null) {
        request.fields['removeImage'] = removeImage ? 'true' : 'false';
      }

      if (newImagePath != null && newImagePath.isNotEmpty) {
        if (kIsWeb) {
          final response = await http.get(Uri.parse(newImagePath));
          final multipartFile = http.MultipartFile.fromBytes(
            'image',
            response.bodyBytes,
            filename: 'image.${_getFileExtension(newImagePath)}',
            contentType: MediaType('image', _getFileExtension(newImagePath)),
          );
          request.files.add(multipartFile);
        } else {
          final file = File(newImagePath);
          if (await file.exists()) {
            final multipartFile = await http.MultipartFile.fromPath(
              'image',
              newImagePath,
              contentType: MediaType('image', _getFileExtension(newImagePath)),
            );
            request.files.add(multipartFile);
          }
        }
      }

      final response = await apiRequest(
          () async {
            _requireSession(session);
            return http.Response.fromStream(await request.send());
          }, session);

      if (response.statusCode == 200 || response.statusCode == 201) {
        _requireSession(session);
        final decoded = json.decode(response.body);
        final post = CommunityPost.fromJson(decoded);
        await _invalidate(session, postId: post.id, language: post.learningLanguage);
        _requireSession(session);
        return post;
      } else {
        throw Exception(response.body);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> deletePost({required String postId, String? learningLanguage, SessionSnapshot? expectedSession}) async {
    try {
      final session = expectedSession ?? AuthService().captureSession();
      _requireSession(session);
      final token = AuthService().token;
      final headers = <String, String>{};
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final url = '${ApiConfig.baseUrl}${ApiConfig.communityPosts}/$postId';
      final response = await apiRequest(
          () { _requireSession(session); return http.delete(Uri.parse(url), headers: headers); }, session);

      if (response.statusCode != 200 && response.statusCode != 204) {
        throw Exception('Failed to delete post: ${response.body}');
      }
      _requireSession(session);
      await _invalidate(session, postId: postId, language: learningLanguage);
      _requireSession(session);
    } catch (e) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> toggleLike({required String postId, SessionSnapshot? expectedSession}) async {
    try {
      final session = expectedSession ?? AuthService().captureSession();
      _requireSession(session);
      final token = AuthService().token;
      final headers = <String, String>{};
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final url = '${ApiConfig.baseUrl}${ApiConfig.communityPosts}/$postId/like';
      final response = await apiRequest(
          () { _requireSession(session); return http.post(Uri.parse(url), headers: headers); }, session);

      if (response.statusCode == 200 || response.statusCode == 201) {
        _requireSession(session);
        final decoded = json.decode(response.body);
        await _invalidate(session, postId: postId);
        _requireSession(session);
        return {
          'likesCount': decoded['likesCount'] ?? 0,
          'likedByMe': decoded['likedByMe'] ?? false,
        };
      } else {
        throw Exception('Failed to toggle like: ${response.body}');
      }
    } catch (e) {
      rethrow;
    }
  }

  String _getFileExtension(String path) {
    final extension = path.split('.').last.toLowerCase();
    if (extension == 'jpg' || extension == 'jpeg') return 'jpeg';
    if (extension == 'png') return 'png';
    if (extension == 'webp') return 'webp';
    return 'jpeg'; // Default
  }
}
