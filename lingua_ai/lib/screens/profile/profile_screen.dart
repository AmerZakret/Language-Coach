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
          ),
          body: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppTheme.standardPadding),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: AppTheme.surfaceColor,
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.03),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        CircleAvatar(
                          radius: 50,
                          backgroundColor: AppTheme.primaryColor.withValues(alpha: 0.1),
                          child: const Icon(
                            Icons.person,
                            size: 50,
                            color: AppTheme.primaryColor,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          auth.isGuest ? lang.getString('guest_user') : auth.currentUserName,
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimaryColor,
                          ),
                        ),
                        if (!auth.isGuest) ...[
                          const SizedBox(height: 4),
                          Text(
                            auth.currentUserEmail,
                            style: const TextStyle(
                              fontSize: 14,
                              color: AppTheme.textSecondaryColor,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                  _buildSectionTitle(lang.getString('learning_stats')),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: _buildStatCard(lang.getString('xp'),
                            '${progress.totalXp}', Icons.bolt_rounded, Colors.orange),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildStatCard(lang.getString('streak'),
                            '${progress.streak}', Icons.local_fire_department_rounded, Colors.red),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildStatCard(lang.getString('lessons'),
                            '${progress.completedLessonsCount}', Icons.menu_book_rounded, Colors.blue),
                      ),
                    ],
                  ),
                  const SizedBox(height: 32),
                  _buildSectionTitle(lang.getString('settings')),
                  const SizedBox(height: 16),
                  _buildListTile(Icons.language_outlined, lang.getString('language_pref'), () {
                    lang.toggleLanguage();
                  }),
                  _buildListTile(Icons.notifications_none_rounded, lang.getString('notifications'), () {}),
                  _buildListTile(Icons.security_rounded, lang.getString('privacy'), () {}),
                  
                  const SizedBox(height: 32),
                  _buildSectionTitle('Testing Tools'),
                  const SizedBox(height: 16),
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.grey.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                    ),
                    child: Column(
                      children: [
                        _buildListTile(Icons.restart_alt_rounded, lang.getString('reset_progress'), () {
                          progress.resetProgress();
                        }, isDense: true),
                        _buildListTile(Icons.translate_rounded, lang.getString('reset_language'), () {
                          lang.resetLanguage();
                        }, isDense: true),
                      ],
                    ),
                  ),
                  const SizedBox(height: 40),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton.icon(
                      onPressed: () {
                        auth.logout();
                        Navigator.pushNamedAndRemoveUntil(context, AppRoutes.login, (route) => false);
                      },
                      icon: const Icon(Icons.logout_rounded, color: Colors.red),
                      label: Text(
                        lang.getString('logout'),
                        style: const TextStyle(
                          color: Colors.red,
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        backgroundColor: Colors.red.withValues(alpha: 0.05),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
                        ),
                      ),
                    ),
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

  Widget _buildStatCard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(AppTheme.cardRadius),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: AppTheme.textPrimaryColor,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            title,
            style: const TextStyle(
              fontSize: 12,
              color: AppTheme.textSecondaryColor,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildListTile(IconData icon, String title, VoidCallback onTap, {bool isDense = false}) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: AppTheme.textSecondaryColor.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: AppTheme.textPrimaryColor, size: 20),
      ),
      title: Text(
        title,
        style: TextStyle(
          color: AppTheme.textPrimaryColor,
          fontWeight: isDense ? FontWeight.w500 : FontWeight.w600,
          fontSize: isDense ? 14 : 16,
        ),
      ),
      trailing: const Icon(Icons.arrow_forward_ios_rounded,
          size: 14, color: AppTheme.textSecondaryColor),
      onTap: onTap,
      contentPadding: EdgeInsets.symmetric(
        horizontal: 16, 
        vertical: isDense ? 0 : 4
      ),
    );
  }
}

