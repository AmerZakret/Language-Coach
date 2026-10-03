import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../core/routes/app_routes.dart';
import '../core/localization/language_service.dart';
import '../services/theme_service.dart';

class BottomNavBar extends StatelessWidget {
  final int currentIndex;

  const BottomNavBar({super.key, required this.currentIndex});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([LanguageService(), ThemeService()]),
      builder: (context, child) {
        final lang = LanguageService();
        final isDark = ThemeService().isDarkMode;
        
        return SafeArea(
          top: false,
          bottom: true,
          child: Container(
            margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF0F111A) : Colors.white,
              borderRadius: BorderRadius.circular(40),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: isDark ? 0.35 : 0.06),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
              border: Border.all(
                color: isDark ? Colors.white.withValues(alpha: 0.06) : Colors.black.withValues(alpha: 0.04),
                width: 1,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildNavItem(context, icon: Icons.home_rounded, label: lang.getString('home'), index: 0, route: AppRoutes.home, isDark: isDark),
                  _buildNavItem(context, icon: Icons.edit_note_rounded, label: lang.getString('writing_practice').split(' ').first, index: 1, route: AppRoutes.writing, isDark: isDark),
                  _buildNavItem(context, icon: Icons.smart_toy_rounded, label: lang.getString('ai_coach').split(' ').last, index: 2, route: AppRoutes.aiCoach, isDark: isDark),
                  _buildNavItem(context, icon: Icons.forum_rounded, label: lang.getString('community'), index: 3, route: AppRoutes.community, isDark: isDark),
                  _buildNavItem(context, icon: Icons.person_rounded, label: lang.getString('profile'), index: 4, route: AppRoutes.profile, isDark: isDark),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildNavItem(BuildContext context, {
    required IconData icon,
    required String label,
    required int index,
    required String route,
    required bool isDark,
  }) {
    final isSelected = currentIndex == index;
    
    return GestureDetector(
      onTap: () {
        if (!isSelected) {
          Navigator.pushReplacementNamed(context, route);
        }
      },
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeInOut,
        padding: isSelected
            ? const EdgeInsets.all(4)
            : EdgeInsets.zero,
        decoration: BoxDecoration(
          color: isSelected
              ? (isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9))
              : Colors.transparent,
          borderRadius: BorderRadius.circular(100),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: isSelected
                    ? AppTheme.secondaryColor // App theme purple
                    : (isDark ? const Color(0xFF1A1F2C) : const Color(0xFFE2E8F0)),
                shape: BoxShape.circle,
              ),
              child: Icon(
                icon,
                size: 20,
                color: isSelected
                    ? Colors.white // White for high contrast on purple
                    : (isDark ? const Color(0xFF94A3B8) : const Color(0xFF64748B)), // Muted for inactive icon
              ),
            ),
            AnimatedSize(
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeInOut,
              alignment: Alignment.centerLeft,
              child: isSelected
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(width: 8),
                        Padding(
                          padding: const EdgeInsets.only(right: 12),
                          child: Text(
                            label,
                            style: TextStyle(
                              color: isDark ? Colors.white : const Color(0xFF0F172A),
                              fontWeight: FontWeight.w800,
                              fontSize: 13,
                              letterSpacing: -0.01,
                            ),
                          ),
                        ),
                      ],
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}
