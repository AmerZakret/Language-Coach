import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/config/api_config.dart';
import '../models/community_post.dart';
import 'auth_service.dart';
import 'connectivity_service.dart';

class CommunityService {
  Future<List<CommunityPost>> fetchPosts({String? language}) async {
    try {
      if (ConnectivityService().isOffline) {
        throw Exception('Device is offline');
      }

      final token = AuthService().token;
      final headers = <String, String>{};
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      String url = '${ApiConfig.baseUrl}${ApiConfig.communityPosts}?page=1&limit=50';
      if (language != null && language.isNotEmpty && language != 'All') {
        url += '&language=$language';
      }

      final response = await http.get(Uri.parse(url), headers: headers);

      if (response.statusCode == 200) {
        // Cache posts in SharedPreferences
        final prefs = await SharedPreferences.getInstance();
        final cacheKey = 'community_posts_${language ?? 'All'}';
        await prefs.setString(cacheKey, response.body);

        final decoded = json.decode(response.body);
        final List items = decoded['items'] ?? [];
        return items.map((item) => CommunityPost.fromJson(item)).toList();
      } else {
        throw Exception('Failed to load community feed: ${response.statusCode}');
      }
    } catch (e) {
      // Fallback to cached posts
      try {
        final prefs = await SharedPreferences.getInstance();
        final cacheKey = 'community_posts_${language ?? 'All'}';
        final cached = prefs.getString(cacheKey);
        if (cached != null) {
          final decoded = json.decode(cached);
          final List items = decoded['items'] ?? [];
          return items.map((item) => CommunityPost.fromJson(item)).toList();
        }
      } catch (_) {}
      rethrow;
    }
  }

  Future<CommunityPost> createPost({
    required String learningLanguage,
    String? text,
    String? imagePath,
  }) async {
    try {
      final token = AuthService().token;
      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.communityPosts}');
      final request = http.MultipartRequest('POST', uri);

      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }

      request.fields['learningLanguage'] = learningLanguage;
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

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200 || response.statusCode == 201) {
        final decoded = json.decode(response.body);
        return CommunityPost.fromJson(decoded);
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
  }) async {
    try {
      final token = AuthService().token;
      final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.communityPosts}/$postId');
      final request = http.MultipartRequest('PUT', uri);

      if (token.isNotEmpty) {
        request.headers['Authorization'] = 'Bearer $token';
      }

      if (text != null && text.trim().isNotEmpty) {
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

      final streamedResponse = await request.send();
      final response = await http.Response.fromStream(streamedResponse);

      if (response.statusCode == 200 || response.statusCode == 201) {
        final decoded = json.decode(response.body);
        return CommunityPost.fromJson(decoded);
      } else {
        throw Exception(response.body);
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> deletePost({required String postId}) async {
    try {
      final token = AuthService().token;
      final headers = <String, String>{};
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final url = '${ApiConfig.baseUrl}${ApiConfig.communityPosts}/$postId';
      final response = await http.delete(Uri.parse(url), headers: headers);

      if (response.statusCode != 200 && response.statusCode != 204) {
        throw Exception('Failed to delete post: ${response.body}');
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<Map<String, dynamic>> toggleLike({required String postId}) async {
    try {
      final token = AuthService().token;
      final headers = <String, String>{};
      if (token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final url = '${ApiConfig.baseUrl}${ApiConfig.communityPosts}/$postId/like';
      final response = await http.post(Uri.parse(url), headers: headers);

      if (response.statusCode == 200 || response.statusCode == 201) {
        final decoded = json.decode(response.body);
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
