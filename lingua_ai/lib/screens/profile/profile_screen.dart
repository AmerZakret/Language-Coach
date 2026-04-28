import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../services/progress_service.dart';
import '../../core/localization/language_service.dart';
import '../../services/auth_service.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

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
          appBar: AppBar(
            title: Text(lang.getString('profile')),
            centerTitle: true,
            actions: [
              IconButton(
                icon: const Icon(Icons.settings),
                onPressed: () {},
              ),
            ],
          ),
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  CircleAvatar(
                    radius: 60,
                    backgroundColor:
                        AppTheme.primaryColor.withValues(alpha: 0.1),
                    child: const Icon(
                      Icons.person,
                      size: 60,
                      color: AppTheme.primaryColor,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    auth.currentUserName,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimaryColor,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    auth.currentUserEmail,
                    style: const TextStyle(
                      fontSize: 16,
                      color: AppTheme.textSecondaryColor,
                    ),
                  ),
                  const SizedBox(height: 32),
                  _buildSectionTitle(lang.getString('learning_stats')),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceAround,
                    children: [
                      _buildStatCard(lang.getString('xp'),
                          '${progress.totalXp}', Icons.star),
                      _buildStatCard(lang.getString('streak'),
                          '${progress.streak}', Icons.local_fire_department),
                      _buildStatCard(lang.getString('lessons'),
                          '${progress.completedLessonsCount}', Icons.menu_book),
                    ],
                  ),
                  const SizedBox(height: 32),
                  _buildSectionTitle(lang.getString('weekly_activity')),
                  const SizedBox(height: 16),
                  _buildWeeklyActivityChart(progress.weeklyActivity),
                  const SizedBox(height: 32),
                  _buildSectionTitle(lang.getString('settings')),
                  const SizedBox(height: 16),
                  _buildListTile(Icons.notifications_outlined,
                      lang.getString('notifications'), () {}),
                  _buildListTile(
                      Icons.language_outlined, lang.getString('language_pref'),
                      () {
                    lang.toggleLanguage();
                  }),
                  _buildListTile(Icons.security_outlined,
                      lang.getString('privacy'), () {}),
                  _buildListTile(
                      Icons.help_outline, lang.getString('help'), () {}),
                  const SizedBox(height: 24),
                  _buildSectionTitle('Testing Tools'),
                  const SizedBox(height: 16),
                  _buildListTile(
                      Icons.restart_alt, lang.getString('reset_progress'), () {
                    progress.resetProgress();
                  }),
                  _buildListTile(
                      Icons.translate, lang.getString('reset_language'), () {
                    lang.resetLanguage();
                  }),
                  const SizedBox(height: 24),
                  ListTile(
                    leading: const Icon(Icons.logout, color: Colors.red),
                    title: Text(lang.getString('logout'),
                        style: const TextStyle(
                            color: Colors.red, fontWeight: FontWeight.bold)),
                    onTap: () {
                      auth.logout();
                      Navigator.pushReplacementNamed(context, AppRoutes.login);
                    },
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    tileColor: Colors.red.withValues(alpha: 0.1),
                  ),
                ],
              ),
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 2),
        );
      },
    );
  }

  Widget _buildSectionTitle(String title) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.bold,
          color: AppTheme.textPrimaryColor,
        ),
      ),
    );
  }

  Widget _buildWeeklyActivityChart(List<double> activity) {
    final days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    return Container(
      padding: const EdgeInsets.all(20),
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
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(7, (index) {
          final barHeight = 100 * activity[index];
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 16,
                height: barHeight == 0 ? 4 : barHeight,
                decoration: BoxDecoration(
                  color: activity[index] > 0
                      ? AppTheme.primaryColor
                      : AppTheme.backgroundColor,
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                days[index],
                style: const TextStyle(
                  color: AppTheme.textSecondaryColor,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          );
        }),
      ),
    );
  }

  Widget _buildStatCard(String title, String value, IconData icon) {
    return Container(
      width: 100,
      padding: const EdgeInsets.all(16),
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
      child: Column(
        children: [
          Icon(icon, color: AppTheme.primaryColor, size: 28),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimaryColor,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            title,
            style: const TextStyle(
              fontSize: 12,
              color: AppTheme.textSecondaryColor,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildListTile(IconData icon, String title, VoidCallback onTap) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 5,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ListTile(
        leading: Icon(icon, color: AppTheme.textSecondaryColor),
        title: Text(
          title,
          style: const TextStyle(
            color: AppTheme.textPrimaryColor,
            fontWeight: FontWeight.bold,
          ),
        ),
        trailing: const Icon(Icons.arrow_forward_ios,
            size: 16, color: AppTheme.textSecondaryColor),
        onTap: onTap,
      ),
    );
  }
}
