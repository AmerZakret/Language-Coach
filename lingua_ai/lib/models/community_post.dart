import '../core/localization/target_language.dart';
class CommunityPost {
  final String id;
  final String userId;
  final String userName;
  final String learningLanguage;
  final String? text;
  final String? imageUrl;
  final List<String> likes;
  final int likesCount;
  final bool likedByMe;
  final String createdAt;
  final String updatedAt;

  CommunityPost({
    required this.id,
    required this.userId,
    required this.userName,
    required this.learningLanguage,
    this.text,
    this.imageUrl,
    required this.likes,
    required this.likesCount,
    required this.likedByMe,
    required this.createdAt,
    required this.updatedAt,
  });

  factory CommunityPost.fromJson(Map<String, dynamic> json) {
    return CommunityPost(
      id: json['_id'] ?? '',
      userId: json['userId'] ?? '',
      userName: json['userName'] ?? '',
      learningLanguage: TargetLanguage.tryCode(json['learningLanguage'] as String?) != null ? TargetLanguage.name(json['learningLanguage']) : (json['learningLanguage'] ?? ''),
      text: json['text'],
      imageUrl: json['imageUrl'],
      likes: List<String>.from(json['likes'] ?? []),
      likesCount: json['likesCount'] ?? 0,
      likedByMe: json['likedByMe'] ?? false,
      createdAt: json['createdAt'] ?? '',
      updatedAt: json['updatedAt'] ?? '',
    );
  }
}
