import 'package:flutter/material.dart';
import '../models/lesson.dart';
import '../core/theme/app_theme.dart';
import '../core/routes/app_routes.dart';
import '../services/progress_service.dart';
import '../core/localization/language_service.dart';

class LessonCard extends StatelessWidget {
  final Lesson lesson;

  const LessonCard({super.key, required this.lesson});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([ProgressService(), LanguageService()]),
      builder: (context, child) {
        final isCompleted = ProgressService().isLessonCompleted(lesson.id);
        final displayProgress = isCompleted ? 1.0 : lesson.progress;
        final lang = LanguageService();
        final Color statusColor = isCompleted ? AppTheme.secondaryColor : AppTheme.primaryColor;

        return GestureDetector(
          onTap: () {
            Navigator.pushNamed(context, AppRoutes.lesson, arguments: lesson);
          },
          child: Container(
            margin: const EdgeInsets.only(bottom: 20),
            decoration: BoxDecoration(
              color: AppTheme.surfaceColor,
              borderRadius: BorderRadius.circular(AppTheme.cardRadius),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.04),
                  blurRadius: 16,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              children: [
                // Left accent line
                Container(
                  width: 8,
                  height: 140, // Approximate card height
                  decoration: BoxDecoration(
                    color: statusColor,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(AppTheme.cardRadius),
                      bottomLeft: Radius.circular(AppTheme.cardRadius),
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: statusColor.withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      lang.getString(lesson.difficulty),
                                      style: TextStyle(
                                        color: statusColor,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: AppTheme.secondaryColor.withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      lesson.category,
                                      style: const TextStyle(
                                        color: AppTheme.secondaryColor,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                    decoration: BoxDecoration(
                                      color: Colors.amber.shade600.withValues(alpha: 0.1),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(Icons.star_rounded, color: Colors.amber.shade600, size: 14),
                                        const SizedBox(width: 4),
                                        Text(
                                          '${lesson.xpReward} XP',
                                          style: TextStyle(
                                            color: Colors.amber.shade600,
                                            fontSize: 12,
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            if (isCompleted)
                              const Icon(Icons.check_circle_rounded, color: AppTheme.secondaryColor, size: 24)
                            else
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.schedule_rounded, color: AppTheme.textSecondaryColor, size: 16),
                                  const SizedBox(width: 4),
                                  Text(
                                    '${lesson.duration} ${lang.getString('min')}',
                                    style: const TextStyle(
                                      color: AppTheme.textSecondaryColor,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        Text(
                          lesson.title,
                          style: const TextStyle(
                            color: AppTheme.textPrimaryColor,
                            fontSize: 22,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          lesson.description,
                          style: const TextStyle(
                            color: AppTheme.textSecondaryColor,
                            fontSize: 14,
                            height: 1.4,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 20),
                        Stack(
                          children: [
                            Container(
                              height: 6,
                              decoration: BoxDecoration(
                                color: AppTheme.backgroundColor,
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                            FractionallySizedBox(
                              widthFactor: displayProgress,
                              child: Container(
                                height: 6,
                                decoration: BoxDecoration(
                                  color: statusColor,
                                  borderRadius: BorderRadius.circular(3),
                                  boxShadow: [
                                    if (displayProgress > 0)
                                      BoxShadow(
                                        color: statusColor.withValues(alpha: 0.4),
                                        blurRadius: 6,
                                        offset: const Offset(0, 2),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
