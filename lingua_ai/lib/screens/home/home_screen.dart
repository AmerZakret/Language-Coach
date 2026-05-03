import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../widgets/lesson_card.dart';
import '../../data/dummy_data.dart';
import '../../models/lesson.dart';
import '../../services/progress_service.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';
import '../../services/lesson_api_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final Map<String, dynamic> userProfile = DummyData.getUserProfile();
  final LessonApiService _apiService = LessonApiService();
  late Future<List<Lesson>> _lessonsFuture;

  @override
  void initState() {
    super.initState();
    _lessonsFuture = _apiService.fetchLessons();
  }

  void _refreshLessons() {
    setState(() {
      _lessonsFuture = _apiService.fetchLessons();
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge(
          [ProgressService(), LanguageService(), AuthService()]),
      builder: (context, child) {
        final progress = ProgressService();
        final lang = LanguageService();
        final auth = AuthService();

        return Scaffold(
          body: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppTheme.standardPadding),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${lang.getString('hello')}, ${auth.isGuest ? lang.getString('guest_user') : auth.currentUserName.split(' ').first}!',
                              style: const TextStyle(
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.textPrimaryColor,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              lang.getString('continue_learning'),
                              style: const TextStyle(
                                fontSize: 16,
                                color: AppTheme.textSecondaryColor,
                              ),
                            ),
                          ],
                        ),
                      ),
                      CircleAvatar(
                        radius: 28,
                        backgroundColor:
                            AppTheme.primaryColor.withValues(alpha: 0.1),
                        child: const Icon(
                          Icons.person,
                          color: AppTheme.primaryColor,
                          size: 32,
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.standardPadding),
                  child: Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppTheme.primaryColor, Color(0xFF8B85FF)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primaryColor.withValues(alpha: 0.3),
                          blurRadius: 15,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildStatCol(
                            lang.getString('level'), userProfile['level']),
                        Container(
                            width: 1,
                            height: 40,
                            color: Colors.white.withValues(alpha: 0.3)),
                        _buildStatCol(
                            lang.getString('xp'), '${progress.totalXp}'),
                        Container(
                            width: 1,
                            height: 40,
                            color: Colors.white.withValues(alpha: 0.3)),
                        _buildStatCol(lang.getString('streak'),
                            '${progress.streak} ${lang.getString('days')}'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.standardPadding),
                  child: Text(
                    lang.getString('available_lessons'),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimaryColor,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: FutureBuilder<List<Lesson>>(
                    future: _lessonsFuture,
                    builder: (context, snapshot) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const Center(
                          child: CircularProgressIndicator(
                            color: AppTheme.primaryColor,
                          ),
                        );
                      }

                      if (snapshot.hasError) {
                        return Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(Icons.error_outline,
                                  size: 48, color: Colors.red),
                              const SizedBox(height: 16),
                              const Text('Failed to load lessons'),
                              TextButton(
                                onPressed: _refreshLessons,
                                child: const Text('Retry'),
                              ),
                            ],
                          ),
                        );
                      }

                      final lessons = snapshot.data ?? [];

                      if (lessons.isEmpty) {
                        return const Center(
                          child: Text('No lessons available'),
                        );
                      }

                      return ListView.builder(
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppTheme.standardPadding),
                        itemCount: lessons.length,
                        itemBuilder: (context, index) {
                          return LessonCard(lesson: lessons[index]);
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 0),
        );
      },
    );
  }

  Widget _buildStatCol(String label, String value) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withValues(alpha: 0.8),
            fontSize: 12,
          ),
        ),
      ],
    );
  }
}
