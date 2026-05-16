import 'dart:math';
import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../services/writing_api_service.dart';
import '../../services/progress_service.dart';

class WritingPracticeScreen extends StatefulWidget {
  const WritingPracticeScreen({super.key});

  @override
  State<WritingPracticeScreen> createState() => _WritingPracticeScreenState();
}

class _WritingPracticeScreenState extends State<WritingPracticeScreen> {
  final TextEditingController _writingController = TextEditingController();
  final WritingApiService _apiService = WritingApiService();
  final Random _random = Random();

  String? _currentTopic;
  bool _isLoading = false;
  WritingFeedback? _feedback;
  bool _xpAwarded = false;

  // predefined topics per target language
  static const Map<String, List<String>> _topics = {
    'en': [
      'Write about your daily routine.',
      'Describe your family.',
      'Write about your favorite food.',
      'Describe your last trip.',
      'Write about your hobbies.',
    ],
    'de': [
      'Write about your daily routine in German.',
      'Introduce yourself in German.',
      'Describe your family in German.',
    ],
    'es': [
      'Write about your daily routine in Spanish.',
      'Introduce yourself in Spanish.',
      'Describe your favorite food in Spanish.',
    ],
    'fr': [
      'Introduce yourself in French.',
      'Describe your school in French.',
      'Write about your hobbies in French.',
    ],
    'ar': [
      'Introduce yourself in Arabic.',
      'Write about your family in Arabic.',
      'Describe your day in Arabic.',
    ],
  };

  void _suggestTopic() {
    final targetLang = TargetLanguageService().currentLanguage;
    final list = _topics[targetLang] ?? _topics['en']!;
    setState(() {
      _currentTopic = list[_random.nextInt(list.length)];
      _feedback = null;
      _xpAwarded = false;
    });
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppTheme.errorColor,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  Future<void> _checkWriting() async {
    final lang = LanguageService();
    if (_currentTopic == null) {
      _showError(lang.getString('select_topic_error'));
      return;
    }
    final text = _writingController.text.trim();
    if (text.isEmpty) {
      _showError(lang.getString('empty_text_error'));
      return;
    }
    final sentenceEnders = RegExp(r'[.!?]').allMatches(text).length;
    if (sentenceEnders < 2 && text.length < 80) {
      _showError(lang.getString('too_short_error'));
      return;
    }

    setState(() {
      _isLoading = true;
      _feedback = null;
    });

    try {
      final feedback = await _apiService.checkWriting(
        topic: _currentTopic!,
        userText: text,
        targetLanguage: TargetLanguageService().currentLanguage,
      );
      if (mounted) {
        setState(() {
          _feedback = feedback;
          _isLoading = false;
        });
        if (!_xpAwarded) {
          ProgressService().addXp(10);
          _xpAwarded = true;
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        _showError(e.toString().replaceAll('Exception: ', ''));
      }
    }
  }

  @override
  void dispose() {
    _writingController.dispose();
    super.dispose();
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
                Text(lang.getString('writing_practice'), style: const TextStyle(fontWeight: FontWeight.w900)),
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
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildTopicSection(lang),
                  const SizedBox(height: 24),

                  _buildWritingInput(lang),
                  const SizedBox(height: 24),

                  ElevatedButton(
                    onPressed: _isLoading ? null : _checkWriting,
                    child: _isLoading 
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : Text(lang.getString('check_writing').toUpperCase()),
                  ),

                  if (_feedback != null) ...[
                    const SizedBox(height: 32),
                    if (_xpAwarded)
                      Container(
                        margin: const EdgeInsets.only(bottom: 24),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: BoxDecoration(
                          color: Colors.amber.shade50,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.amber.shade200),
                        ),
                        child: const Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.bolt_rounded, color: Colors.amber, size: 20),
                            SizedBox(width: 8),
                            Text('+10 XP Earned!', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.amber)),
                          ],
                        ),
                      ),
                    _buildScoreCards(lang),
                    const SizedBox(height: 20),
                    _buildCorrectedVersion(lang),
                    const SizedBox(height: 20),
                    _buildFeedbackCard(lang),
                    if (_feedback!.mistakes.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      _buildMistakesCard(lang),
                    ],
                    const SizedBox(height: 32),
                  ],
                ],
              ),
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 1),
        );
      },
    );
  }

  Widget _buildTopicSection(LanguageService lang) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: _currentTopic != null ? AppTheme.primaryGradient : null,
        color: _currentTopic == null ? Colors.white : null,
        borderRadius: BorderRadius.circular(24),
        boxShadow: _currentTopic != null ? AppTheme.softShadow : AppTheme.cardShadow,
        border: _currentTopic == null ? Border.all(color: Colors.grey.shade100) : null,
      ),
      child: Column(
        children: [
          if (_currentTopic != null) ...[
            Text(
              lang.getString('your_topic').toUpperCase(),
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Colors.white.withValues(alpha: 0.7), letterSpacing: 1.2),
            ),
            const SizedBox(height: 12),
            Text(
              _currentTopic!,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white, height: 1.3),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            TextButton.icon(
              onPressed: _suggestTopic,
              icon: const Icon(Icons.refresh_rounded, color: Colors.white, size: 18),
              label: Text(lang.getString('suggest_topic'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
              style: TextButton.styleFrom(
                backgroundColor: Colors.white.withValues(alpha: 0.2),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ] else ...[
            const Icon(Icons.lightbulb_outline_rounded, size: 40, color: AppTheme.primaryColor),
            const SizedBox(height: 16),
            Text(
              lang.getString('suggest_topic'),
              style: const TextStyle(fontSize: 15, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _suggestTopic,
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12)),
              child: Text(lang.getString('suggest_topic')),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildWritingInput(LanguageService lang) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.grey.shade100),
        boxShadow: AppTheme.cardShadow,
      ),
      child: TextField(
        controller: _writingController,
        maxLines: 6,
        maxLength: 500,
        style: const TextStyle(fontSize: 16, color: AppTheme.textPrimaryColor, height: 1.5),
        decoration: InputDecoration(
          hintText: lang.getString('write_answer'),
          hintStyle: const TextStyle(color: AppTheme.textSecondaryColor),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.all(20),
        ),
      ),
    );
  }

  Widget _buildScoreCards(LanguageService lang) {
    return Row(
      children: [
        Expanded(child: _buildScorePill(lang.getString('grammar'), _feedback!.grammarScore, Colors.blue)),
        const SizedBox(width: 12),
        Expanded(child: _buildScorePill(lang.getString('vocabulary'), _feedback!.vocabularyScore, Colors.orange)),
        const SizedBox(width: 12),
        Expanded(child: _buildScorePill(lang.getString('clarity'), _feedback!.clarityScore, AppTheme.secondaryColor)),
      ],
    );
  }

  Widget _buildScorePill(String label, int score, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(color: Colors.grey.shade100),
      ),
      child: Column(
        children: [
          Text(
            '$score',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: color),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppTheme.textSecondaryColor),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildCorrectedVersion(LanguageService lang) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.green.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            lang.getString('corrected_version').toUpperCase(),
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Colors.green, letterSpacing: 1.1),
          ),
          const SizedBox(height: 12),
          Text(
            _feedback!.correctedVersion,
            style: const TextStyle(fontSize: 15, color: AppTheme.textPrimaryColor, height: 1.5, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }

  Widget _buildFeedbackCard(LanguageService lang) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.shade100),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            lang.getString('feedback').toUpperCase(),
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: AppTheme.primaryColor, letterSpacing: 1.1),
          ),
          const SizedBox(height: 12),
          Text(
            _feedback!.overallFeedback,
            style: const TextStyle(fontSize: 15, color: AppTheme.textPrimaryColor, height: 1.5),
          ),
        ],
      ),
    );
  }

  Widget _buildMistakesCard(LanguageService lang) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.red.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            lang.getString('mistakes').toUpperCase(),
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w900, color: Colors.red, letterSpacing: 1.1),
          ),
          const SizedBox(height: 12),
          Text(
            _feedback!.mistakes,
            style: const TextStyle(fontSize: 15, color: AppTheme.textPrimaryColor, height: 1.5),
          ),
        ],
      ),
    );
  }
}
