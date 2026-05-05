import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../widgets/custom_text_field.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/ai_coach_api_service.dart';

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
  final List<Map<String, dynamic>> _messages = [];

  @override
  void initState() {
    super.initState();
    // Add initial greeting based on language
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final lang = LanguageService();
      setState(() {
        _messages.add({
          'text': lang.currentLanguage == 'tr'
              ? 'Merhaba! Bugün İngilizcenizi geliştirmenize nasıl yardımcı olabilirim?'
              : 'Hello! How can I help you with your English today?',
          'isBot': true,
        });
      });
    });
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
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

      final response = await _apiService.sendMessage(
        userId: userId,
        message: text,
        language: language,
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
      listenable: LanguageService(),
      builder: (context, child) {
        final lang = LanguageService();
        return Scaffold(
          appBar: AppBar(
            title: Text(lang.getString('ai_coach')),
            centerTitle: true,
          ),
          body: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView.builder(
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
                    padding: EdgeInsets.symmetric(vertical: 8.0),
                    child: CircularProgressIndicator(),
                  ),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.05),
                        blurRadius: 10,
                        offset: const Offset(0, -4),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: CustomTextField(
                          controller: _messageController,
                          hintText: lang.getString('type_message'),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Container(
                        decoration: const BoxDecoration(
                          color: AppTheme.primaryColor,
                          shape: BoxShape.circle,
                        ),
                        child: IconButton(
                          icon: const Icon(Icons.send, color: Colors.white),
                          onPressed: _isLoading ? null : _sendMessage,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 1),
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
            constraints: const BoxConstraints(maxWidth: 280),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
            decoration: BoxDecoration(
              color: isBot ? AppTheme.surfaceColor : AppTheme.primaryColor,
              borderRadius: BorderRadius.circular(20).copyWith(
                bottomLeft: isBot ? const Radius.circular(0) : const Radius.circular(20),
                bottomRight: !isBot ? const Radius.circular(0) : const Radius.circular(20),
              ),
              border: isBot ? Border.all(color: AppTheme.backgroundColor, width: 2) : null,
            ),
            child: Text(
              text,
              style: TextStyle(
                color: isBot ? AppTheme.textPrimaryColor : Colors.white,
                fontSize: 16,
              ),
            ),
          ),
          if (correction != null && correction.isNotEmpty && correction.trim().toLowerCase() != text.trim().toLowerCase())
            Padding(
              padding: const EdgeInsets.only(top: 8, left: 10),
              child: Text(
                'Correct: $correction',
                style: const TextStyle(
                  color: Colors.green,
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
