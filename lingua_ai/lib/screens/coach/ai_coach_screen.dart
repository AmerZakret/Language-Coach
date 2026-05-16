import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/ai_coach_api_service.dart';
import '../../core/localization/target_language_service.dart';

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

    setState(() {
      _isHistoryLoading = true;
      _messages.clear();
    });

    try {
      final auth = AuthService();
      final userId = auth.isGuest || auth.currentUserEmail.isEmpty
          ? 'guest'
          : auth.currentUserEmail;
      final targetLanguage = TargetLanguageService().getLanguageName(TargetLanguageService().currentLanguage);

      final history = await _apiService.getHistory(
        userId: userId,
        targetLanguage: targetLanguage,
      );

      if (mounted) {
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
      final auth = AuthService();
      final userId = auth.isGuest || auth.currentUserEmail.isEmpty
          ? 'guest'
          : auth.currentUserEmail;
      final language = LanguageService().currentLanguage;
      final targetLanguageCode = TargetLanguageService().currentLanguage;
      final targetLanguageName = TargetLanguageService().getLanguageName(targetLanguageCode);

      final response = await _apiService.sendMessage(
        userId: userId,
        message: text,
        language: language,
        targetLanguage: targetLanguageName,
      );

      setState(() {
        _messages.add({
          'text': response['reply'] ?? 'No reply received.',
          'isBot': true,
          'correction': response['correction'],
        });
      });
    } catch (e) {
      setState(() {
        _messages.add({
          'text': LanguageService().currentLanguage == 'tr' 
              ? 'Bağlantı hatası: YZ Koç ile iletişim kurulamadı.' 
              : 'Connection error: Cannot communicate with AI Coach.',
          'isBot': true,
        });
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
        _scrollToBottom();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([LanguageService(), TargetLanguageService()]),
      builder: (context, child) {
        final lang = LanguageService();
        final targetLang = TargetLanguageService();
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
          ),
          body: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: _isHistoryLoading 
                    ? const Center(child: CircularProgressIndicator())
                    : _messages.isEmpty 
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                padding: const EdgeInsets.all(24),
                                decoration: BoxDecoration(
                                  color: AppTheme.primaryLight,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.auto_awesome_rounded, size: 48, color: AppTheme.primaryColor),
                              ),
                              const SizedBox(height: 24),
                              Text(
                                lang.getString('start_practicing'),
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.textPrimaryColor),
                              ),
                            ],
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
                    color: Colors.white,
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 20, offset: const Offset(0, -4)),
                    ],
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
                            decoration: InputDecoration(
                              hintText: lang.getString('type_message'),
                              hintStyle: const TextStyle(color: AppTheme.textSecondaryColor),
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
              color: isBot ? Colors.white : null,
              borderRadius: BorderRadius.circular(20).copyWith(
                bottomLeft: isBot ? const Radius.circular(4) : const Radius.circular(20),
                bottomRight: !isBot ? const Radius.circular(4) : const Radius.circular(20),
              ),
              boxShadow: [
                BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 4)),
              ],
              border: isBot ? Border.all(color: Colors.grey.shade100) : null,
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
