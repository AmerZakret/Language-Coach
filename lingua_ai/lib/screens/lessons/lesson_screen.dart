import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../models/lesson.dart';
import '../../widgets/custom_button.dart';
import '../../services/progress_service.dart';
import '../../core/localization/language_service.dart';

import '../../services/lesson_api_service.dart';

class LessonScreen extends StatefulWidget {
  const LessonScreen({super.key});

  @override
  State<LessonScreen> createState() => _LessonScreenState();
}

class _LessonScreenState extends State<LessonScreen> {
  int currentQuestionIndex = 0;
  int score = 0;
  String? selectedAnswer;
  Lesson? lesson;
  bool _isLoading = false;
  final LessonApiService _apiService = LessonApiService();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (lesson == null) {
      final args = ModalRoute.of(context)?.settings.arguments;
      if (args is Lesson) {
        lesson = args;
        // If the lesson object from list doesn't have questions, fetch the full details
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
        setState(() => _isLoading = false);
      }
    }
  }

  void _nextStep() {
    if (lesson == null || selectedAnswer == null) return;

    final currentQuestion = lesson!.questions[currentQuestionIndex];
    if (selectedAnswer == currentQuestion.correctAnswer) {
      score++;
    }

    setState(() {
      if (currentQuestionIndex < lesson!.questions.length - 1) {
        currentQuestionIndex++;
        selectedAnswer = null;
      } else {
        ProgressService().completeLesson(lesson!.id, lesson!.xpReward);
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
      listenable: LanguageService(),
      builder: (context, child) {
        final lang = LanguageService();
        
        if (_isLoading || lesson == null) {
          return Scaffold(
            appBar: AppBar(
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ),
            body: const Center(
              child: CircularProgressIndicator(color: AppTheme.primaryColor),
            ),
          );
        }

        if (lesson!.questions.isEmpty) {
          return Scaffold(
            appBar: AppBar(
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ),
            body: Center(child: Text(lang.getString('no_questions'))),
          );
        }

        final currentQuestion = lesson!.questions[currentQuestionIndex];
        final progress = (currentQuestionIndex + 1) / lesson!.questions.length;
        final totalQuestions = lesson!.questions.length;
        final currentNumber = currentQuestionIndex + 1;

        return Scaffold(
          appBar: AppBar(
            leading: IconButton(
              icon: const Icon(Icons.close),
              onPressed: () => Navigator.pop(context),
            ),
            title: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: LinearProgressIndicator(
                value: progress,
                backgroundColor: AppTheme.primaryColor.withValues(alpha: 0.1),
                valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.secondaryColor),
                minHeight: 12,
              ),
            ),
            actions: [
              Padding(
                padding: const EdgeInsets.only(right: 16.0),
                child: Center(
                  child: Text(
                    '$currentNumber/$totalQuestions',
                    style: const TextStyle(
                      color: AppTheme.textSecondaryColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            ],
          ),
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppTheme.standardPadding),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 16),
                  Text(
                    lang.getString('translate_sentence'),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppTheme.textPrimaryColor,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceColor,
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.04),
                          blurRadius: 15,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Text(
                      currentQuestion.text,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.primaryColor,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 40),
                  Expanded(
                    child: ListView.separated(
                      physics: const BouncingScrollPhysics(),
                      itemCount: currentQuestion.options.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        final option = currentQuestion.options[index];
                        return _buildOption(option);
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  CustomButton(
                    text: currentQuestionIndex == totalQuestions - 1 
                        ? lang.getString('finish') 
                        : lang.getString('next'),
                    onPressed: selectedAnswer != null ? _nextStep : () {},
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildOption(String text) {
    final isSelected = selectedAnswer == text;
    
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      child: Material(
        color: isSelected ? AppTheme.primaryColor : AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
        elevation: isSelected ? 4 : 0,
        child: InkWell(
          onTap: () {
            setState(() {
              selectedAnswer = text;
            });
          },
          borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              border: Border.all(
                color: isSelected 
                    ? AppTheme.primaryColor 
                    : AppTheme.textSecondaryColor.withValues(alpha: 0.1), 
                width: 2,
              ),
              borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    text,
                    style: TextStyle(
                      fontSize: 16,
                      color: isSelected ? Colors.white : AppTheme.textPrimaryColor,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                    ),
                  ),
                ),
                if (isSelected)
                  const Icon(Icons.check_circle_outline, color: Colors.white, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
