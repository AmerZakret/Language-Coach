import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../widgets/custom_button.dart';

class LessonResultScreen extends StatelessWidget {
  const LessonResultScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final args = ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
    final score = args?['score'] ?? 0;
    final total = args?['total'] ?? 0;
    final xp = args?['xp'] ?? 0;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              Container(
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(
                  color: AppTheme.secondaryColor.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.star_rounded,
                  size: 100,
                  color: AppTheme.secondaryColor,
                ),
              ),
              const SizedBox(height: 48),
              const Text(
                'Lesson Completed!',
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimaryColor,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                'You scored $score / $total!\nYou earned $xp XP\nGreat job keeping up your streak!',
                style: const TextStyle(
                  fontSize: 18,
                  color: AppTheme.textSecondaryColor,
                ),
                textAlign: TextAlign.center,
              ),
              const Spacer(),
              CustomButton(
                text: 'Continue',
                onPressed: () {
                  Navigator.popUntil(context, ModalRoute.withName(AppRoutes.home));
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}
