import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/api_response.dart';
import '../../services/ai_coach_api_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../services/theme_service.dart';
import '../../services/connectivity_service.dart';

class AiCoachScreen extends StatefulWidget {
  const AiCoachScreen({super.key});

  @override
  State<AiCoachScreen> createState() => _AiCoachScreenState();
}

class _AiCoachScreenState extends State<AiCoachScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final AiCoachApiService _apiService = AiCoachApiService();
  
  bool _isLoading = false;
  bool _isHistoryLoading = true;
  final List<Map<String, dynamic>> _messages = [];

  @override
  void initState() {
    super.initState();
    TargetLanguageService().addListener(_loadHistory);
    AuthService().addListener(_loadHistory);
    _loadHistory();
  }

  @override
  void dispose() {
    TargetLanguageService().removeListener(_loadHistory);
    AuthService().removeListener(_loadHistory);
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    if (!mounted) return;
    if (AuthService().token.isEmpty) {
      setState(() { _messages.clear(); _isHistoryLoading = false; _isLoading = false; });
      return;
    }
    final session = AuthService().captureSession();

    setState(() {
      _isHistoryLoading = true;
      _messages.clear();
    });

    try {
      final targetLanguage = TargetLanguageService().currentLanguage;

      final history = await _apiService.getHistory(
        targetLanguage: targetLanguage,
      );

      if (mounted && session.isCurrent) {
        setState(() {
          for (var msg in history) {
            _messages.add({
              'text': msg['message'] ?? '',
              'isBot': msg['role'] == 'assistant',
            });
          }
          _isHistoryLoading = false;
        });
        _scrollToBottom();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isHistoryLoading = false;
        });
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;
    final session = AuthService().captureSession();

    setState(() {
      _messages.add({
        'text': text,
        'isBot': false,
      });
      _isLoading = true;
    });
    _messageController.clear();
    _scrollToBottom();

    try {
      final language = LanguageService().currentLanguage;
      final targetLanguageCode = TargetLanguageService().currentLanguage;

      final response = await _apiService.sendMessage(
        message: text,
        language: language,
        targetLanguage: targetLanguageCode,
      );

      if (!mounted || !session.isCurrent) return;
      setState(() {
        _messages.add({
          'text': response['reply'] ?? 'No reply received.',
          'isBot': true,
          'correction': response['correction'],
        });
      });
    } catch (e) {
      if (mounted && canHandleApiError(session, e)) {
        if (session.isCurrent && _messages.isNotEmpty) {
          setState(() => _messages.removeLast());
        }
        final errorMsg = e.toString().replaceAll('Exception: ', '');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(errorMsg),
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
        _scrollToBottom();
      }
    }
  }

  Future<void> _clearChat() async {
    final lang = LanguageService();
    final targetLang = TargetLanguageService();

    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: ThemeService().isDarkMode ? const Color(0xFF1E293B) : Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          title: Text(
            lang.getString('delete_post_title'),
            style: TextStyle(color: AppTheme.textPrimaryColor, fontWeight: FontWeight.w900),
          ),
          content: Text(
            lang.getString('delete_post_warning'),
            style: TextStyle(color: AppTheme.textSecondaryColor),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(lang.getString('cancel'), style: const TextStyle(color: Colors.grey)),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(lang.getString('delete'), style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );

    if (confirm == true) {
      setState(() => _isLoading = true);
      try {
        await _apiService.clearHistory(
          targetLanguage: targetLang.currentLanguage,
        );
        setState(() {
          _messages.clear();
        });
      } catch (e) {
        debugPrint('Failed to clear chat: $e');
      } finally {
        if (mounted) {
          setState(() => _isLoading = false);
        }
      }
    }
  }

  List<String> _getStarterPrompts(LanguageService lang, TargetLanguageService targetLang) {
    final targetLangName = targetLang.getLanguageName(targetLang.currentLanguage);
    if (lang.currentLanguage == 'tr') {
      return [
        'Alışveriş kalıpları pratiği yapmama yardım et',
        'Bir restoranda yemek siparişi verme pratiği yapalım',
        'Kendimi resmi olarak nasıl tanıtırım?',
        '$targetLangName dilindeki geçmiş zaman kurallarını açıkla',
      ];
    } else {
      return [
        'Help me practice shopping phrases',
        "Let's practice ordering food at a restaurant",
        'How do I introduce myself formally?',
        'Explain past tense rules in $targetLangName',
      ];
    }
  }

  Widget _buildOfflineScreen(LanguageService lang) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.orange.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.wifi_off_rounded,
                size: 64,
                color: Colors.orangeAccent,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              lang.getString('offline_mode'),
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                color: AppTheme.textPrimaryColor,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              lang.getString('offline_coach_desc'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14,
                height: 1.5,
                color: AppTheme.textSecondaryColor,
              ),
            ),
          ],
        ),
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
        final targetLang = TargetLanguageService();
        final isOffline = ConnectivityService().isOffline;

        return Scaffold(
          appBar: AppBar(
            title: Column(
              children: [
                Text(lang.getString('ai_coach'), style: const TextStyle(fontWeight: FontWeight.w900)),
                const SizedBox(height: 2),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryLight,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${lang.getString('practicing')}: ${targetLang.getLanguageFlag(targetLang.currentLanguage)} ${targetLang.getLanguageName(targetLang.currentLanguage)}',
                    style: const TextStyle(fontSize: 11, color: AppTheme.primaryColor, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
            centerTitle: true,
            actions: [
              IconButton(
                icon: const Icon(Icons.delete_sweep_rounded, color: Colors.redAccent),
                onPressed: (isOffline || _messages.isEmpty) ? null : _clearChat,
              ),
            ],
          ),
          body: SafeArea(
            child: isOffline
                ? _buildOfflineScreen(lang)
                : Column(
                    children: [
                      Expanded(
                        child: _isHistoryLoading 
                            ? const Center(child: CircularProgressIndicator())
                    : _messages.isEmpty 
                      ? SingleChildScrollView(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 40.0),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: AppTheme.primaryLight,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Image.asset(
                                    'assets/images/ai-coach-icon.png',
                                    width: 64,
                                    height: 64,
                                    fit: BoxFit.contain,
                                  ),
                                ),
                                const SizedBox(height: 24),
                                Text(
                                  lang.getString('start_practicing'),
                                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.textPrimaryColor),
                                ),
                                const SizedBox(height: 24),
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 24),
                                  child: Column(
                                    children: _getStarterPrompts(lang, targetLang).map((prompt) {
                                      return GestureDetector(
                                        onTap: () {
                                          _messageController.text = prompt;
                                          _sendMessage();
                                        },
                                        child: Container(
                                          width: double.infinity,
                                          margin: const EdgeInsets.only(bottom: 12),
                                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                          decoration: BoxDecoration(
                                            color: ThemeService().isDarkMode ? const Color(0xFF1E293B) : Colors.white,
                                            borderRadius: BorderRadius.circular(16),
                                            border: Border.all(
                                              color: ThemeService().isDarkMode
                                                  ? Colors.white.withValues(alpha: 0.08)
                                                  : Colors.grey.shade200,
                                            ),
                                            boxShadow: [
                                              BoxShadow(
                                                color: Colors.black.withValues(alpha: 0.02),
                                                blurRadius: 10,
                                                offset: const Offset(0, 4),
                                              ),
                                            ],
                                          ),
                                          child: Row(
                                            children: [
                                              const Icon(
                                                Icons.chat_bubble_outline_rounded,
                                                size: 16,
                                                color: AppTheme.primaryColor,
                                              ),
                                              const SizedBox(width: 12),
                                              Expanded(
                                                child: Text(
                                                  prompt,
                                                  style: TextStyle(
                                                    fontSize: 13,
                                                    fontWeight: FontWeight.w600,
                                                    color: AppTheme.textPrimaryColor,
                                                  ),
                                                ),
                                              ),
                                              const Icon(
                                                Icons.arrow_forward_ios_rounded,
                                                size: 12,
                                                color: Colors.grey,
                                              ),
                                            ],
                                          ),
                                        ),
                                      );
                                    }).toList(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.all(24),
                          itemCount: _messages.length,
                          itemBuilder: (context, index) {
                            final msg = _messages[index];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 16),
                              child: _buildMessage(
                                text: msg['text'] as String,
                                isBot: msg['isBot'] as bool,
                                correction: msg['correction'] as String?,
                              ),
                            );
                          },
                        ),
                ),
                if (_isLoading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12.0),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: ThemeService().isDarkMode ? 0.2 : 0.05),
                        blurRadius: 20,
                        offset: const Offset(0, -4),
                      ),
                    ],
                    border: Border(
                      top: BorderSide(
                        color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.grey.shade100,
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Container(
                          decoration: BoxDecoration(
                            color: AppTheme.backgroundColor,
                            borderRadius: BorderRadius.circular(24),
                          ),
                          child: TextField(
                            controller: _messageController,
                            enabled: !_isHistoryLoading,
                            style: TextStyle(color: AppTheme.textPrimary),
                            decoration: InputDecoration(
                              hintText: lang.getString('type_message'),
                              hintStyle: TextStyle(color: AppTheme.textSecondary),
                              border: InputBorder.none,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      GestureDetector(
                        onTap: (_isLoading || _isHistoryLoading) ? null : _sendMessage,
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            gradient: (_isLoading || _isHistoryLoading) ? null : AppTheme.primaryGradient,
                            color: (_isLoading || _isHistoryLoading) ? Colors.grey.shade300 : null,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.send_rounded, color: Colors.white, size: 22),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 2),
        );
      },
    );
  }

  Widget _buildMessage({required String text, required bool isBot, String? correction}) {
    return Align(
      alignment: isBot ? Alignment.centerLeft : Alignment.centerRight,
      child: Column(
        crossAxisAlignment: isBot ? CrossAxisAlignment.start : CrossAxisAlignment.end,
        children: [
          Container(
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            decoration: BoxDecoration(
              gradient: isBot ? null : AppTheme.primaryGradient,
              color: isBot ? AppTheme.surfaceColor : null,
              borderRadius: BorderRadius.circular(20).copyWith(
                bottomLeft: isBot ? const Radius.circular(4) : const Radius.circular(20),
                bottomRight: !isBot ? const Radius.circular(4) : const Radius.circular(20),
              ),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 4)),
              ],
              border: isBot ? Border.all(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.grey.shade100) : null,
            ),
            child: Text(
              text,
              style: TextStyle(
                color: isBot ? AppTheme.textPrimaryColor : Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          if (correction != null && correction.isNotEmpty && correction.trim().toLowerCase() != text.trim().toLowerCase())
            Container(
              margin: const EdgeInsets.only(top: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFD1FAE5),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                correction,
                style: const TextStyle(color: Colors.green, fontSize: 13, fontWeight: FontWeight.w700),
              ),
            ),
        ],
      ),
    );
  }
}
