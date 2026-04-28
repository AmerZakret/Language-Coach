import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../models/lesson.dart';
import '../../widgets/custom_button.dart';
import '../../services/progress_service.dart';
import '../../core/localization/language_service.dart';

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

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (lesson == null) {
      final args = ModalRoute.of(context)?.settings.arguments;
      if (args is Lesson) {
        lesson = args;
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
        
        if (lesson == null) {
          return Scaffold(
            appBar: AppBar(
              leading: IconButton(
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.pop(context),
              ),
            ),
            body: Center(child: Text(lang.getString('error_loading'))),
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

        return Scaffold(
          appBar: AppBar(
            leading: IconButton(
              icon: const Icon(Icons.close),
              onPressed: () => Navigator.pop(context),
            ),
            title: LinearProgressIndicator(
              value: progress,
              backgroundColor: AppTheme.backgroundColor,
              valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.secondaryColor),
              minHeight: 12,
              borderRadius: BorderRadius.circular(6),
            ),
          ),
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 32),
                  Text(
                    lang.getString('translate_sentence'),
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimaryColor,
                    ),
                  ),
                  const SizedBox(height: 32),
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceColor,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.05),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Text(
                      currentQuestion.text,
                      style: const TextStyle(
                        fontSize: 20,
                        color: AppTheme.textPrimaryColor,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 48),
                  Expanded(
                    child: ListView.separated(
                      itemCount: currentQuestion.options.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 16),
                      itemBuilder: (context, index) {
                        final option = currentQuestion.options[index];
                        return _buildOption(option);
                      },
                    ),
                  ),
                  CustomButton(
                    text: currentQuestionIndex == lesson!.questions.length - 1 
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
    
    return InkWell(
      onTap: () {
        setState(() {
          selectedAnswer = text;
        });
      },
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primaryColor.withValues(alpha: 0.1) : Colors.transparent,
          border: Border.all(
            color: isSelected 
                ? AppTheme.primaryColor 
                : AppTheme.textSecondaryColor.withValues(alpha: 0.2), 
            width: 2,
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 16,
            color: isSelected ? AppTheme.primaryColor : AppTheme.textPrimaryColor,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
          ),
        ),
      ),
    );
  }
}
