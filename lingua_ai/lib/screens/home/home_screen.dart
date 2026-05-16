import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../models/lesson.dart';
import '../../services/progress_service.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/lesson_api_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../widgets/target_language_modal.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final LessonApiService _apiService = LessonApiService();
  late Future<List<Lesson>> _lessonsFuture;

  @override
  void initState() {
    super.initState();
    TargetLanguageService().addListener(_onTargetLanguageChanged);
    _lessonsFuture = _apiService.fetchLessons(TargetLanguageService().currentLanguage);
  }

  void _onTargetLanguageChanged() {
    if (mounted) {
      setState(() {
        _lessonsFuture = _apiService.fetchLessons(TargetLanguageService().currentLanguage);
      });
    }
  }

  @override
  void dispose() {
    TargetLanguageService().removeListener(_onTargetLanguageChanged);
    super.dispose();
  }

  Map<String, dynamic> _getLevelInfo(int xp) {
    if (xp >= 2200) return {'level': 'Advanced', 'progress': 1.0, 'nextXp': 2200};
    if (xp >= 1400) return {'level': 'Upper-Intermediate', 'progress': (xp - 1400) / (2200 - 1400), 'nextXp': 2200};
    if (xp >= 900) return {'level': 'Intermediate', 'progress': (xp - 900) / (1400 - 900), 'nextXp': 1400};
    if (xp >= 500) return {'level': 'Pre-Intermediate', 'progress': (xp - 500) / (900 - 500), 'nextXp': 900};
    if (xp >= 200) return {'level': 'Elementary', 'progress': (xp - 200) / (500 - 200), 'nextXp': 500};
    return {'level': 'Beginner', 'progress': xp / 200, 'nextXp': 200};
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(
          [ProgressService(), LanguageService(), AuthService(), TargetLanguageService()]),
      builder: (context, child) {
        final progress = ProgressService();
        final lang = LanguageService();
        final auth = AuthService();
        final targetLang = TargetLanguageService();

        final levelInfo = _getLevelInfo(progress.totalXp);
        final String currentLevel = levelInfo['level'];
        final double progressPercent = levelInfo['progress'];
        final int nextXp = levelInfo['nextXp'];

        return Scaffold(
          body: SafeArea(
            child: FutureBuilder<List<Lesson>>(
              future: _lessonsFuture,
              builder: (context, snapshot) {
                final lessons = snapshot.data ?? [];
                
                Lesson? recommendedLesson;
                if (lessons.isNotEmpty) {
                  recommendedLesson = lessons.cast<Lesson?>().firstWhere(
                    (l) => l != null && !progress.completedLessonIds.contains(l.id) && (l.difficulty == currentLevel),
                    orElse: () => lessons.cast<Lesson?>().firstWhere(
                      (l) => l != null && !progress.completedLessonIds.contains(l.id),
                      orElse: () => null,
                    ),
                  );
                }

                return CustomScrollView(
                  physics: const BouncingScrollPhysics(),
                  slivers: [
                    // --- Header (Web Style) ---
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  auth.isGuest ? lang.getString('welcome_guest') : '${lang.getString('welcome_back')}, ${auth.currentUserName.split(' ').first} 👋',
                                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
                                ),
                                Text(
                                  '${lang.getString('keep_learning')} ${targetLang.currentLanguage} ${lang.getString('today')}',
                                  style: const TextStyle(fontSize: 15, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
                                ),
                              ],
                            ),
                            _buildLanguageBadge(targetLang),
                          ],
                        ),
                      ),
                    ),

                    // --- Stats Grid ---
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: GridView.count(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          crossAxisCount: 2,
                          mainAxisSpacing: 16,
                          crossAxisSpacing: 16,
                          childAspectRatio: 1.6,
                          children: [
                            _buildStatCard(lang.getString('xp'), '${progress.totalXp}', Icons.bolt_rounded, Colors.orange),
                            _buildStatCard(lang.getString('level'), lang.getString(currentLevel), Icons.trending_up_rounded, AppTheme.primaryColor),
                            _buildStatCard(lang.getString('streak'), '${progress.streak}', Icons.local_fire_department_rounded, Colors.redAccent),
                            _buildStatCard(lang.getString('completed'), '${progress.completedLessonsCount}', Icons.check_box_rounded, Colors.green),
                          ],
                        ),
                      ),
                    ),

                    // --- Centered Level Progress Card ---
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(24),
                            boxShadow: AppTheme.cardShadow,
                            border: Border.all(color: Colors.grey.shade100),
                          ),
                          child: Column(
                            children: [
                              Text(
                                '${lang.getString('level')}: ${lang.getString(currentLevel)}',
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppTheme.textPrimary),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'XP: ${progress.totalXp} / $nextXp',
                                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textSecondary),
                              ),
                              const SizedBox(height: 20),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(10),
                                child: LinearProgressIndicator(
                                  value: progressPercent,
                                  minHeight: 12,
                                  backgroundColor: AppTheme.backgroundColor,
                                  valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.primaryColor),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),

                    // --- Recommended Lesson Card ---
                    if (snapshot.connectionState == ConnectionState.done && recommendedLesson != null)
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: Container(
                            padding: const EdgeInsets.all(24),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(24),
                              boxShadow: AppTheme.cardShadow,
                              border: Border.all(color: Colors.grey.shade100),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  lang.getString('continue_learning').toUpperCase(),
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppTheme.primaryColor, letterSpacing: 1),
                                ),
                                const SizedBox(height: 16),
                                Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            recommendedLesson.title,
                                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
                                          ),
                                          const SizedBox(height: 4),
                                          Text(
                                            recommendedLesson.description,
                                            style: const TextStyle(fontSize: 14, color: AppTheme.textSecondary, fontWeight: FontWeight.w500),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(width: 16),
                                    IconButton.filled(
                                      onPressed: () => Navigator.pushNamed(context, AppRoutes.lesson, arguments: recommendedLesson),
                                      icon: const Icon(Icons.arrow_forward_rounded),
                                      style: IconButton.styleFrom(
                                        backgroundColor: AppTheme.primaryColor,
                                        padding: const EdgeInsets.all(16),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),

                    // --- Lessons Section ---
                    if (snapshot.connectionState == ConnectionState.done && lessons.isNotEmpty) ...[
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(24, 40, 24, 20),
                          child: Text(
                            lang.getString('available_lessons'),
                            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
                          ),
                        ),
                      ),
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(24, 0, 24, 40),
                        sliver: SliverGrid(
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            mainAxisSpacing: 16,
                            crossAxisSpacing: 16,
                            childAspectRatio: 1.8, // Much wider cards
                          ),
                          delegate: SliverChildBuilderDelegate(
                            (context, index) {
                              final lesson = lessons[index];
                              final isCompleted = progress.completedLessonIds.contains(lesson.id);
                              return InkWell(
                                onTap: () => Navigator.pushNamed(context, AppRoutes.lesson, arguments: lesson),
                                borderRadius: BorderRadius.circular(20),
                                child: Container(
                                  padding: const EdgeInsets.all(16),
                                  decoration: BoxDecoration(
                                    color: isCompleted ? const Color(0xFFF0FDF4) : Colors.white,
                                    borderRadius: BorderRadius.circular(20),
                                    boxShadow: AppTheme.cardShadow,
                                    border: Border.all(color: isCompleted ? Colors.green.withValues(alpha: 0.2) : Colors.grey.shade100),
                                  ),
                                  child: Stack(
                                    children: [
                                      Positioned(
                                        right: -10,
                                        bottom: -10,
                                        child: Opacity(
                                          opacity: 0.2, // Increased from 0.1 and removed tint
                                          child: Image.asset(
                                            'assets/images/lesson.png',
                                            width: 60,
                                            height: 60,
                                          ),
                                        ),
                                      ),
                                      Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                            decoration: BoxDecoration(
                                              color: AppTheme.backgroundColor,
                                              borderRadius: BorderRadius.circular(8),
                                            ),
                                            child: Text(
                                              lesson.category.toUpperCase(),
                                              style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w800, color: AppTheme.textSecondary),
                                            ),
                                          ),
                                          if (isCompleted)
                                            const Icon(Icons.check_box_rounded, color: Colors.green, size: 14),
                                        ],
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        lesson.title,
                                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: AppTheme.textPrimary, height: 1.2),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        '${lesson.xpReward} XP • ${lesson.duration}m',
                                        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppTheme.textSecondary),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                            },
                            childCount: lessons.length,
                          ),
                        ),
                      ),
                    ],
                  ],
                );
              }
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 0),
        );
      },
    );
  }

  Widget _buildStatCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(color: Colors.grey.shade100),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  value,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  label,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppTheme.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLanguageBadge(TargetLanguageService targetLang) {
    return GestureDetector(
      onTap: () {
        showModalBottomSheet(
          context: context,
          backgroundColor: Colors.transparent,
          isScrollControlled: true,
          builder: (context) => const TargetLanguageModal(),
        );
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(50),
          boxShadow: AppTheme.cardShadow,
          border: Border.all(color: Colors.grey.shade100),
        ),
        child: Row(
          children: [
            Text(targetLang.getLanguageFlag(targetLang.currentLanguage), style: const TextStyle(fontSize: 18)),
            const SizedBox(width: 8),
            Text(
              targetLang.currentLanguage.toUpperCase(),
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppTheme.textPrimary),
            ),
          ],
        ),
      ),
    );
  }
}
