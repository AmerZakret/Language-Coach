import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';

class LessonResultScreen extends StatelessWidget {
  const LessonResultScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final args = ModalRoute.of(context)?.settings.arguments as Map<String, dynamic>?;
    final score = args?['score'] ?? 0;
    final total = args?['total'] ?? 0;
    final xp = args?['xp'] ?? 0;
    
    final bool isSuccess = total > 0 && (score / total) >= 0.5;

    return ListenableBuilder(
      listenable: Listenable.merge([LanguageService(), TargetLanguageService()]),
      builder: (context, child) {
        return Scaffold(
          backgroundColor: Colors.white,
          body: Stack(
            children: [
              Positioned(
                top: -100,
                right: -100,
                child: Container(
                  width: 300,
                  height: 300,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: (isSuccess ? Colors.green : Colors.red).withValues(alpha: 0.05),
                  ),
                ),
              ),
              SafeArea(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    return SingleChildScrollView(
                      physics: const BouncingScrollPhysics(),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                        constraints: BoxConstraints(
                          minHeight: constraints.maxHeight,
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const SizedBox(height: 16),
                            // Celebrate / Replay Icon
                            Center(
                              child: Container(
                                padding: const EdgeInsets.all(32),
                                decoration: BoxDecoration(
                                  color: isSuccess ? const Color(0xFFF0FDF4) : const Color(0xFFFEF2F2),
                                  shape: BoxShape.circle,
                                  border: Border.all(color: (isSuccess ? Colors.green : Colors.red).withValues(alpha: 0.1), width: 8),
                                ),
                                child: Image.asset(
                                  'assets/images/language-learning.png',
                                  width: 80,
                                  height: 80,
                                ),
                              ),
                            ),
                            
                            const SizedBox(height: 32),
                            
                            Text(
                              isSuccess ? 'Great Job!' : 'Keep Practicing!',
                              style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: AppTheme.textPrimary, letterSpacing: -1),
                              textAlign: TextAlign.center,
                            ),
                            
                            const SizedBox(height: 12),
                            
                            Text(
                              isSuccess 
                                ? 'You\'ve mastered this lesson and earned some serious XP!'
                                : 'Don\'t give up! Every mistake is a step closer to fluency.',
                              style: const TextStyle(fontSize: 16, color: AppTheme.textSecondary, fontWeight: FontWeight.w500, height: 1.4),
                              textAlign: TextAlign.center,
                            ),

                            const SizedBox(height: 32),

                            // Score & XP Tiles
                            Row(
                              children: [
                                Expanded(
                                  child: _buildResultTile(
                                    'SCORE', 
                                    '$score/$total', 
                                    Icons.analytics_rounded, 
                                    AppTheme.primaryColor
                                  ),
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: _buildResultTile(
                                    'XP EARNED', 
                                    '+$xp', 
                                    Icons.bolt_rounded, 
                                    Colors.orange
                                  ),
                                ),
                              ],
                            ),

                            const SizedBox(height: 32),

                            // Actions
                            if (!isSuccess) ...[
                              ElevatedButton(
                                onPressed: () => Navigator.pop(context),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: AppTheme.primaryColor,
                                  padding: const EdgeInsets.symmetric(vertical: 18),
                                ),
                                child: const Text('RETRY LESSON', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
                              ),
                              const SizedBox(height: 12),
                            ],
                            
                            TextButton(
                              onPressed: () {
                                Navigator.pushNamedAndRemoveUntil(context, AppRoutes.home, (route) => false);
                              },
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(vertical: 18),
                              ),
                              child: Text(
                                'CONTINUE TO HOME', 
                                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppTheme.textSecondary.withValues(alpha: 0.7)),
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],
                        ),
                      ),
                    );
                  }
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildResultTile(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.grey.shade100),
        boxShadow: AppTheme.glassShadow,
      ),
      child: Column(
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppTheme.textPrimary)),
          Text(
            label, 
            style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: AppTheme.textSecondary, letterSpacing: 0.5),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
