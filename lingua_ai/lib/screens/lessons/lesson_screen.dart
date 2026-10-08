import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../models/lesson.dart';
import '../../services/progress_service.dart';
import '../../core/localization/language_service.dart';
import '../../services/lesson_api_service.dart';
import '../../services/sound_service.dart';
import '../../services/theme_service.dart';

class LessonScreen extends StatefulWidget {
  const LessonScreen({super.key});

  @override
  State<LessonScreen> createState() => _LessonScreenState();
}

class _LessonScreenState extends State<LessonScreen> {
  int currentQuestionIndex = 0;
  int score = 0;
  String? selectedAnswer;
  bool isChecked = false;
  Lesson? lesson;
  bool _isLoading = false;
  bool _loadFailed = false;
  final LessonApiService _apiService = LessonApiService();
  final SoundService _soundService = SoundService();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (lesson == null) {
      final args = ModalRoute.of(context)?.settings.arguments;
      if (args is Lesson) {
        lesson = args;
        if (lesson!.questions.isEmpty) {
          _fetchFullLesson();
        }
      }
    }
  }

  Future<void> _fetchFullLesson() async {
    if (lesson == null) return;
    setState(() => _isLoading = true);
    try {
      final fullLesson = await _apiService.fetchLessonById(lesson!.id);
      if (mounted) {
        setState(() {
          lesson = fullLesson;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _loadFailed = true;
        });
      }
    }
  }

  void _checkAnswer() {
    if (lesson == null || lesson!.questions.isEmpty || selectedAnswer == null) return;

    final currentQuestion = lesson!.questions[currentQuestionIndex];
    final isCorrect = selectedAnswer == currentQuestion.correctAnswer;

    if (isCorrect) {
      score++;
      _soundService.playCorrect();
    } else {
      _soundService.playWrong();
    }

    setState(() {
      isChecked = true;
    });
  }

  void _nextQuestion() {
    if (lesson == null || lesson!.questions.isEmpty) return;

    setState(() {
      if (currentQuestionIndex < lesson!.questions.length - 1) {
        currentQuestionIndex++;
        selectedAnswer = null;
        isChecked = false;
      } else {
        ProgressService().completeLesson(lesson!.id, lesson!.xpReward,
            lessonLanguage: lesson!.targetLanguage,
            score: ((score / lesson!.questions.length) * 100).round());
        Navigator.pushReplacementNamed(
          context, 
          AppRoutes.lessonResult,
          arguments: {
            'score': score,
            'total': lesson!.questions.length,
            'xp': lesson!.xpReward,
          },
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([LanguageService(), ThemeService()]),
      builder: (context, child) {
        final lang = LanguageService();
        
        if (_isLoading || lesson == null) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator(color: AppTheme.primaryColor)),
          );
        }

        if (_loadFailed || lesson!.questions.isEmpty) {
          return Scaffold(
            appBar: AppBar(title: Text(lang.getString('error_loading'))),
            body: Center(child: Text(lang.getString('no_questions'))),
          );
        }

        final currentQuestion = lesson!.questions[currentQuestionIndex];
        final progress = (currentQuestionIndex + 1) / lesson!.questions.length;
        final totalQuestions = lesson!.questions.length;
        final currentNumber = currentQuestionIndex + 1;

        final isCorrect = isChecked && selectedAnswer == currentQuestion.correctAnswer;

        return Scaffold(
          backgroundColor: AppTheme.backgroundColor,
          appBar: AppBar(
            backgroundColor: AppTheme.surfaceColor,
            elevation: 0,
            leading: IconButton(
              icon: Icon(Icons.close_rounded, color: AppTheme.textSecondary),
              onPressed: () => Navigator.pop(context),
            ),
            title: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                height: 8,
                child: LinearProgressIndicator(
                  value: progress,
                  backgroundColor: AppTheme.backgroundColor,
                  valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.accentColor),
                ),
              ),
            ),
            actions: [
              Center(
                child: Padding(
                  padding: const EdgeInsets.only(right: 20),
                  child: Text(
                    '$currentNumber / $totalQuestions',
                    style: TextStyle(color: AppTheme.textSecondary, fontWeight: FontWeight.w800, fontSize: 13),
                  ),
                ),
              ),
            ],
          ),
          body: Column(
            children: [
              Expanded(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        lang.getString('translate_sentence'),
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppTheme.textPrimary, letterSpacing: -0.5),
                      ),
                      const SizedBox(height: 32),
                      
                      // Question Bubble
                      Container(
                        padding: const EdgeInsets.all(32),
                        decoration: BoxDecoration(
                          color: ThemeService().isDarkMode ? AppTheme.surfaceColor : AppTheme.backgroundColor,
                          borderRadius: BorderRadius.circular(24),
                          border: Border.all(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.grey.shade100),
                        ),
                        child: Text(
                          currentQuestion.question,
                          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: AppTheme.textPrimary, height: 1.3),
                          textAlign: TextAlign.center,
                        ),
                      ),
                      
                      const SizedBox(height: 48),
                      
                      // Options Grid/List
                      ...currentQuestion.options.map((option) => Padding(
                        padding: const EdgeInsets.only(bottom: 16.0),
                        child: _buildOption(option, currentQuestion.correctAnswer),
                      )),
                    ],
                  ),
                ),
              ),
              
              // Bottom Action Section
              _buildBottomAction(lang, isCorrect),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBottomAction(LanguageService lang, bool isCorrect) {
    if (isChecked) {
      return Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: isCorrect ? const Color(0xFFF0FDF4) : const Color(0xFFFEF2F2),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 20)],
        ),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    isCorrect ? Icons.check_circle_rounded : Icons.error_rounded,
                    color: isCorrect ? Colors.green : Colors.red,
                    size: 32,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      isCorrect ? 'Excellent!' : 'Correct answer:',
                      style: TextStyle(
                        fontSize: 20, 
                        fontWeight: FontWeight.w900, 
                        color: isCorrect ? Colors.green.shade900 : Colors.red.shade900
                      ),
                    ),
                  ),
                ],
              ),
              if (!isCorrect) ...[
                const SizedBox(height: 8),
                Text(
                  lesson!.questions[currentQuestionIndex].correctAnswer,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.red.shade900),
                ),
              ],
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _nextQuestion,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isCorrect ? Colors.green : Colors.red,
                    padding: const EdgeInsets.symmetric(vertical: 20),
                  ),
                  child: const Text('CONTINUE', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 1)),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(top: BorderSide(color: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : const Color(0xFFF1F5F9))),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: selectedAnswer == null ? null : _checkAnswer,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 20),
              backgroundColor: AppTheme.primaryColor,
              disabledBackgroundColor: ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.05) : Colors.grey.shade200,
            ),
            child: const Text('CHECK', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16, letterSpacing: 1)),
          ),
        ),
      ),
    );
  }

  Widget _buildOption(String text, String correctAnswer) {
    final isSelected = selectedAnswer == text;
    
    Color bgColor = ThemeService().isDarkMode ? AppTheme.surfaceColor : Colors.white;
    Color borderColor = ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : const Color(0xFFE2E8F0);
    Color textColor = AppTheme.textPrimary;

    if (isChecked) {
      if (text == correctAnswer) {
        bgColor = ThemeService().isDarkMode ? const Color(0xFF0F3A20) : const Color(0xFFDCFCE7);
        borderColor = Colors.green;
        textColor = ThemeService().isDarkMode ? Colors.green.shade200 : Colors.green.shade900;
      } else if (isSelected) {
        bgColor = ThemeService().isDarkMode ? const Color(0xFF4A1515) : const Color(0xFFFEE2E2);
        borderColor = Colors.red;
        textColor = ThemeService().isDarkMode ? Colors.red.shade200 : Colors.red.shade900;
      }
    } else if (isSelected) {
      bgColor = AppTheme.primaryColor.withValues(alpha: 0.05);
      borderColor = AppTheme.primaryColor;
      textColor = AppTheme.primaryColor;
    }

    return InkWell(
      onTap: isChecked ? null : () => setState(() => selectedAnswer = text),
      borderRadius: BorderRadius.circular(24),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 24),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: borderColor, width: isSelected || (isChecked && text == correctAnswer) ? 2 : 1.5),
          boxShadow: isSelected && !isChecked ? [
            BoxShadow(color: AppTheme.primaryColor.withValues(alpha: 0.1), blurRadius: 10, offset: const Offset(0, 4))
          ] : null,
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 17,
            fontWeight: isSelected || (isChecked && text == correctAnswer) ? FontWeight.w800 : FontWeight.w600,
            color: textColor,
          ),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
