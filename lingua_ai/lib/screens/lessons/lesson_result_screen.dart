import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../widgets/custom_button.dart';
import '../../core/localization/language_service.dart';

class LessonResultScreen extends StatelessWidget {
  const LessonResultScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final args = ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
    final score = args?['score'] ?? 0;
    final total = args?['total'] ?? 0;
    final xp = args?['xp'] ?? 0;

    return ListenableBuilder(
      listenable: LanguageService(),
      builder: (context, child) {
        final lang = LanguageService();
        
        return Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(AppTheme.standardPadding),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Spacer(),
                  Icon(
                    Icons.emoji_events_rounded,
                    size: 120,
                    color: AppTheme.secondaryColor.withValues(alpha: 0.8),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    lang.getString('lesson_completed'),
                    style: const TextStyle(
                      fontSize: 36,
                      fontWeight: FontWeight.w900,
                      color: AppTheme.textPrimaryColor,
                      letterSpacing: -1,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    lang.getString('great_job'),
                    style: const TextStyle(
                      fontSize: 18,
                      color: AppTheme.textSecondaryColor,
                      fontWeight: FontWeight.w500,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 48),
                  Container(
                    padding: const EdgeInsets.all(32),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceColor,
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.05),
                          blurRadius: 20,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildResultStat(
                          lang.getString('you_scored').split(' ').first,
                          '$score/$total',
                          Icons.query_stats_rounded,
                          AppTheme.primaryColor,
                        ),
                        Container(width: 1, height: 50, color: AppTheme.backgroundColor),
                        _buildResultStat(
                          lang.getString('xp'),
                          '+$xp',
                          Icons.bolt_rounded,
                          Colors.orange,
                        ),
                      ],
                    ),
                  ),
                  const Spacer(),
                  CustomButton(
                    text: lang.getString('continue'),
                    onPressed: () {
                      Navigator.pushNamedAndRemoveUntil(context, AppRoutes.home, (route) => false);
                    },
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildResultStat(String label, String value, IconData icon, Color color) {
    return Column(
      children: [
        Icon(icon, color: color, size: 28),
        const SizedBox(height: 8),
        Text(
          value,
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
            color: AppTheme.textPrimaryColor,
          ),
        ),
        Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            color: AppTheme.textSecondaryColor,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

