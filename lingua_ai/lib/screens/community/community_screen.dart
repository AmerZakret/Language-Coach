import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme/app_theme.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../services/auth_service.dart';
import '../../services/community_service.dart';
import '../../services/theme_service.dart';
import '../../models/community_post.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../core/config/api_config.dart';
import '../../services/connectivity_service.dart';

class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  final CommunityService _communityService = CommunityService();
  final ImagePicker _picker = ImagePicker();

  List<CommunityPost> _posts = [];
  bool _isLoading = true;
  String? _errorMessage;

  // Filter Language
  String _selectedLanguage = 'All';
  final List<String> _languages = ['All', 'English', 'German', 'Spanish', 'French', 'Arabic'];

  final Map<String, String> _languageFlags = {
    'English': '🇬🇧',
    'German': '🇩🇪',
    'Spanish': '🇪🇸',
    'French': '🇫🇷',
    'Arabic': '🇸🇦',
  };

  // Form controllers
  final TextEditingController _postTextController = TextEditingController();
  String _learningLanguage = 'English';
  XFile? _selectedImage;
  bool _isPosting = false;

  @override
  void initState() {
    super.initState();
    // Default learningLanguage to current targetLanguage
    final targetLangCode = TargetLanguageService().currentLanguage;
    _learningLanguage = TargetLanguageService.toFullName(targetLangCode);
    _loadFeed();
  }

  @override
  void dispose() {
    _postTextController.dispose();
    super.dispose();
  }

  Future<void> _loadFeed() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final posts = await _communityService.fetchPosts(
        language: _selectedLanguage == 'All' ? null : _selectedLanguage,
      );
      setState(() {
        _posts = posts;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  Future<void> _pickImage() async {
    final lang = LanguageService();
    try {
      final picked = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
      );
      if (picked != null) {
        setState(() {
          _selectedImage = picked;
        });
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${lang.getString('failed_pick_image')}: $e')),
      );
    }
  }

  void _clearImage() {
    setState(() {
      _selectedImage = null;
    });
  }

  Future<void> _createPost(LanguageService lang) async {
    final text = _postTextController.text.trim();
    if (text.isEmpty && _selectedImage == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(lang.getString('empty_post_error'))),
      );
      return;
    }

    setState(() => _isPosting = true);

    try {
      await _communityService.createPost(
        learningLanguage: _learningLanguage,
        text: text.isNotEmpty ? text : null,
        imagePath: _selectedImage?.path,
      );

      _postTextController.clear();
      _clearImage();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(lang.getString('post_shared_success'))),
      );
      _loadFeed();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${lang.getString('failed_share_post')}: $e')),
      );
    } finally {
      if (mounted) {
        setState(() => _isPosting = false);
      }
    }
  }

  Future<void> _toggleLike(CommunityPost post) async {
    final lang = LanguageService();
    if (ConnectivityService().isOffline) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(lang.getString('offline_community_desc')),
          backgroundColor: Colors.orangeAccent,
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }

    final postId = post.id;
    final previouslyLiked = post.likedByMe;
    final previousCount = post.likesCount;

    // Optimistic UI updates
    setState(() {
      final index = _posts.indexWhere((p) => p.id == postId);
      if (index != -1) {
        _posts[index] = CommunityPost(
          id: post.id,
          userId: post.userId,
          userName: post.userName,
          learningLanguage: post.learningLanguage,
          text: post.text,
          imageUrl: post.imageUrl,
          likes: post.likes,
          likesCount: previouslyLiked ? previousCount - 1 : previousCount + 1,
          likedByMe: !previouslyLiked,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
        );
      }
    });

    try {
      await _communityService.toggleLike(postId: postId);
    } catch (e) {
      // Revert on error
      setState(() {
        final index = _posts.indexWhere((p) => p.id == postId);
        if (index != -1) {
          _posts[index] = post;
        }
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${LanguageService().getString('failed_update_like')}: $e')),
      );
    }
  }

  Future<void> _showEditDialog(CommunityPost post, LanguageService lang) async {
    final editController = TextEditingController(text: post.text);
    bool isSaving = false;

    showDialog(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (statefulContext, setDialogState) {
            return AlertDialog(
              backgroundColor: AppTheme.surfaceColor,
              surfaceTintColor: AppTheme.surfaceColor,
              title: Text(
                lang.getString('edit'),
                style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: editController,
                    maxLines: 4,
                    maxLength: 1000,
                    style: TextStyle(color: AppTheme.textPrimary),
                    decoration: InputDecoration(
                      hintText: lang.getString('share_tip'),
                      hintStyle: TextStyle(color: ThemeService().isDarkMode ? Colors.grey.shade500 : Colors.grey.shade400),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.15) : Colors.grey.shade200),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(16),
                        borderSide: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.15) : Colors.grey.shade200),
                      ),
                      filled: true,
                      fillColor: AppTheme.backgroundColor,
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: isSaving ? null : () => Navigator.pop(dialogContext),
                  child: Text(lang.getString('cancel')),
                ),
                ElevatedButton(
                  onPressed: isSaving
                      ? null
                      : () async {
                          final text = editController.text.trim();
                          if (text.isEmpty) return;

                          setDialogState(() => isSaving = true);
                          try {
                            await _communityService.updatePost(
                              postId: post.id,
                              text: text,
                            );
                            if (!dialogContext.mounted) return;
                            Navigator.pop(dialogContext);
                            _loadFeed();
                          } catch (e) {
                            if (!statefulContext.mounted) return;
                            ScaffoldMessenger.of(statefulContext).showSnackBar(
                              SnackBar(content: Text('${lang.getString('failed_update_post')}: $e')),
                            );
                          } finally {
                            setDialogState(() => isSaving = false);
                          }
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryColor,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: isSaving
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(lang.getString('save'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _showDeleteDialog(CommunityPost post, LanguageService lang) async {
    showDialog(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: AppTheme.surfaceColor,
          surfaceTintColor: AppTheme.surfaceColor,
          title: Text(
            lang.getString('delete_post_title'),
            style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
          ),
          content: Text(
            lang.getString('confirm_delete'),
            style: TextStyle(color: AppTheme.textSecondary),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: Text(lang.getString('cancel')),
            ),
            ElevatedButton(
              onPressed: () async {
                try {
                  await _communityService.deletePost(postId: post.id);
                  if (!dialogContext.mounted) return;
                  Navigator.pop(dialogContext);
                  
                  if (!mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(lang.getString('post_deleted_success'))),
                  );
                  _loadFeed();
                } catch (e) {
                  if (!dialogContext.mounted) return;
                  Navigator.pop(dialogContext);
                  
                  if (!mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('${lang.getString('failed_delete_post')}: $e')),
                  );
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: Text(lang.getString('delete'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  String _formatTime(String dateStr) {
    try {
      final d = DateTime.parse(dateStr).toLocal();
      final now = DateTime.now();
      final diff = now.difference(d);
      final lang = LanguageService();

      if (diff.inMinutes < 1) return lang.getString('just_now');
      if (diff.inMinutes < 60) return lang.getString('m_ago').replaceAll('{num}', '${diff.inMinutes}');
      if (diff.inHours < 24) return lang.getString('h_ago').replaceAll('{num}', '${diff.inHours}');
      if (diff.inDays < 7) return lang.getString('d_ago').replaceAll('{num}', '${diff.inDays}');

      return '${d.day}/${d.month}/${d.year}';
    } catch (_) {
      return '';
    }
  }

  Widget _buildOfflineBanner(LanguageService lang) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: Colors.orange.withValues(alpha: 0.1),
      child: Row(
        children: [
          const Icon(Icons.wifi_off_rounded, color: Colors.orangeAccent, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              lang.getString('offline_community_desc'),
              style: const TextStyle(
                color: Colors.orangeAccent,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([
        LanguageService(),
        TargetLanguageService(),
        ThemeService(),
        ConnectivityService()
      ]),
      builder: (context, child) {
        final lang = LanguageService();
        final auth = AuthService();
        final isOffline = ConnectivityService().isOffline;

        return Scaffold(
          backgroundColor: AppTheme.backgroundColor,
          appBar: AppBar(
            backgroundColor: AppTheme.surfaceColor,
            elevation: 0,
            title: Text(
              lang.getString('community'),
              style: TextStyle(fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
            ),
          ),
          body: SafeArea(
            child: Column(
              children: [
                if (isOffline) _buildOfflineBanner(lang),
                // --- 1. Language Filter row ---
                Container(
                  color: AppTheme.surfaceColor,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    physics: const BouncingScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Row(
                      children: _languages.map((l) {
                        final isSelected = _selectedLanguage == l;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8.0),
                          child: GestureDetector(
                            onTap: () {
                              setState(() {
                                _selectedLanguage = l;
                              });
                              _loadFeed();
                            },
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              decoration: BoxDecoration(
                                color: isSelected ? AppTheme.primaryColor.withValues(alpha: 0.1) : AppTheme.surfaceColor,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: isSelected
                                      ? AppTheme.primaryColor.withValues(alpha: 0.3)
                                      : (ThemeService().isDarkMode
                                          ? Colors.white.withValues(alpha: 0.08)
                                          : Colors.grey.shade200),
                                ),
                              ),
                              child: Text(
                                l == 'All' ? lang.getString('all_languages') : '${_languageFlags[l] ?? ''} ${lang.getString('lang_${l.toLowerCase()}')}',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: isSelected ? AppTheme.primaryColor : AppTheme.textSecondary,
                                ),
                              ),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                ),

                // --- 2. Main scrolling view (Creation Box + Feed List) ---
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _loadFeed,
                    color: AppTheme.primaryColor,
                    child: CustomScrollView(
                      physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
                      slivers: [
                        // Creation Box
                        SliverToBoxAdapter(
                          child: _buildCreatePostCard(lang),
                        ),

                        // Feed Items
                        if (_isLoading && _posts.isEmpty)
                          const SliverFillRemaining(
                            child: Center(
                              child: CircularProgressIndicator(color: AppTheme.primaryColor),
                            ),
                          )
                        else if (_errorMessage != null)
                          SliverFillRemaining(
                            child: Center(
                              child: Padding(
                                padding: const EdgeInsets.all(24.0),
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    const Icon(Icons.error_outline_rounded, color: Colors.red, size: 40),
                                    const SizedBox(height: 12),
                                    Text(
                                      _errorMessage!,
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.red),
                                    ),
                                    const SizedBox(height: 16),
                                    ElevatedButton.icon(
                                      onPressed: _loadFeed,
                                      icon: const Icon(Icons.refresh, color: Colors.white),
                                      label: Text(lang.getString('retry'), style: const TextStyle(color: Colors.white)),
                                      style: ElevatedButton.styleFrom(backgroundColor: AppTheme.primaryColor),
                                    )
                                  ],
                                ),
                              ),
                            ),
                          )
                        else if (_posts.isEmpty)
                          SliverFillRemaining(
                            child: Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.language_rounded, color: Colors.grey, size: 48),
                                  const SizedBox(height: 16),
                                  Text(
                                    lang.getString('no_posts_yet'),
                                    style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textSecondary),
                                  ),
                                ],
                              ),
                            ),
                          )
                        else
                          SliverList(
                            delegate: SliverChildListDelegate(
                              _posts.map((post) => _buildPostCard(post, auth, lang)).toList(),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 3),
        );
      },
    );
  }

  Widget _buildCreatePostCard(LanguageService lang) {
    if (ConnectivityService().isOffline) {
      return const SizedBox.shrink();
    }
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(24),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(
          color: ThemeService().isDarkMode
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.grey.shade100,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            lang.getString('what_did_you_learn'),
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 12),

          // Selector for learning language
          DropdownButtonFormField<String>(
            initialValue: _learningLanguage,
            dropdownColor: AppTheme.surfaceColor,
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontFamily: 'Outfit'),
            decoration: InputDecoration(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.15) : Colors.grey.shade200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.15) : Colors.grey.shade200),
              ),
              filled: true,
              fillColor: AppTheme.backgroundColor,
            ),
            items: _languages.where((l) => l != 'All').map((l) {
              return DropdownMenuItem(
                value: l,
                child: Text('${_languageFlags[l] ?? ''} ${lang.getString('lang_${l.toLowerCase()}')}', style: TextStyle(color: AppTheme.textPrimary)),
              );
            }).toList(),
            onChanged: (v) {
              if (v != null) {
                setState(() {
                  _learningLanguage = v;
                });
              }
            },
          ),
          const SizedBox(height: 12),

          // Text Field
          TextField(
            controller: _postTextController,
            maxLines: 3,
            maxLength: 1000,
            style: TextStyle(color: AppTheme.textPrimary),
            decoration: InputDecoration(
              hintText: lang.getString('share_tip'),
              hintStyle: TextStyle(color: ThemeService().isDarkMode ? Colors.grey.shade500 : Colors.grey.shade400, fontSize: 13),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.15) : Colors.grey.shade200),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.15) : Colors.grey.shade200),
              ),
              filled: true,
              fillColor: AppTheme.backgroundColor,
              contentPadding: const EdgeInsets.all(16),
            ),
          ),

          // Image Preview
          if (_selectedImage != null) ...[
            const SizedBox(height: 12),
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: kIsWeb
                      ? Image.network(
                          _selectedImage!.path,
                          height: 140,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        )
                      : Image.file(
                          File(_selectedImage!.path),
                          height: 140,
                          width: double.infinity,
                          fit: BoxFit.cover,
                        ),
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: GestureDetector(
                    onTap: _clearImage,
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: const BoxDecoration(
                        color: Colors.black54,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.close, color: Colors.white, size: 16),
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 16),

          // Bottom Buttons
          Row(
            children: [
              IconButton.filledTonal(
                onPressed: _pickImage,
                icon: const Icon(Icons.image_rounded, color: AppTheme.primaryColor),
                style: IconButton.styleFrom(
                  backgroundColor: AppTheme.primaryColor.withValues(alpha: 0.1),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: _isPosting ? null : () => _createPost(lang),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryColor,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: _isPosting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text(
                          lang.getString('post'),
                          style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                        ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPostCard(CommunityPost post, AuthService auth, LanguageService lang) {
    final isOwner = post.userId == auth.currentUserId;
    final hasLiked = post.likedByMe;
    
    // Construct full image URL
    final String? fullImageUrl = post.imageUrl != null
        ? (post.imageUrl!.startsWith('http')
            ? post.imageUrl
            : '${ApiConfig.baseUrl}${post.imageUrl}')
        : null;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(24),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(
          color: ThemeService().isDarkMode
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.grey.shade100,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Card Header
          Row(
            children: [
              // User avatar circle
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  gradient: AppTheme.premiumGradient,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    post.userName.isNotEmpty ? post.userName.substring(0, 1).toUpperCase() : 'U',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ),
              ),
              const SizedBox(width: 12),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        Text(
                          post.userName,
                          style: TextStyle(fontWeight: FontWeight.w800, color: AppTheme.textPrimary, fontSize: 14),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: AppTheme.primaryColor.withValues(alpha: 0.05),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: AppTheme.primaryColor.withValues(alpha: 0.15)),
                          ),
                          child: Text(
                            '${lang.getString('learning')} ${_languageFlags[post.learningLanguage] ?? ''} ${lang.getString('lang_${post.learningLanguage.toLowerCase()}')}',
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: AppTheme.primaryColor,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _formatTime(post.createdAt),
                      style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                    ),
                  ],
                ),
              ),

              // Owner controls
              if (isOwner)
                PopupMenuButton<String>(
                  icon: Icon(Icons.more_vert, color: AppTheme.textSecondary),
                  color: AppTheme.surfaceColor,
                  onSelected: (v) {
                    if (ConnectivityService().isOffline) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(lang.getString('offline_community_desc')),
                          backgroundColor: Colors.orangeAccent,
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                      return;
                    }
                    if (v == 'edit') {
                      _showEditDialog(post, lang);
                    } else if (v == 'delete') {
                      _showDeleteDialog(post, lang);
                    }
                  },
                  itemBuilder: (context) {
                    return [
                      PopupMenuItem(
                        value: 'edit',
                        child: Row(
                          children: [
                            Icon(Icons.edit_rounded, size: 18, color: AppTheme.textSecondary),
                            const SizedBox(width: 8),
                            Text(lang.getString('edit'), style: TextStyle(color: AppTheme.textPrimary)),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            const Icon(Icons.delete_rounded, size: 18, color: Colors.red),
                            const SizedBox(width: 8),
                            Text(
                              lang.getString('delete'),
                              style: const TextStyle(color: Colors.red),
                            ),
                          ],
                        ),
                      ),
                    ];
                  },
                ),
            ],
          ),
          const SizedBox(height: 16),

          // Post Text
          if (post.text != null && post.text!.isNotEmpty)
            Text(
              post.text!,
              style: TextStyle(fontSize: 14, color: AppTheme.textPrimary, height: 1.4),
            ),

          // Post Image
          if (fullImageUrl != null) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(
                fullImageUrl,
                fit: BoxFit.cover,
                width: double.infinity,
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    height: 120,
                    decoration: BoxDecoration(
                      color: ThemeService().isDarkMode ? Colors.white10 : Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Center(
                      child: Icon(Icons.broken_image_rounded, color: ThemeService().isDarkMode ? Colors.white30 : Colors.grey, size: 28),
                    ),
                  );
                },
              ),
            ),
          ],
          const SizedBox(height: 16),

          // Post Actions (Like only)
          Divider(height: 1, color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : const Color(0xFFF1F5F9)),
          const SizedBox(height: 12),
          GestureDetector(
            onTap: () => _toggleLike(post),
            behavior: HitTestBehavior.opaque,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  hasLiked ? Icons.favorite_rounded : Icons.favorite_outline_rounded,
                  color: hasLiked ? Colors.red : AppTheme.textSecondary,
                  size: 20,
                ),
                const SizedBox(width: 6),
                Text(
                  '${post.likesCount} ${lang.getString('like')}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: hasLiked ? Colors.red : AppTheme.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}


