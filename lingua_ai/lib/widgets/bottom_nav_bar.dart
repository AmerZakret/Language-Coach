import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../core/routes/app_routes.dart';
import '../core/localization/language_service.dart';

class BottomNavBar extends StatelessWidget {
  final int currentIndex;

  const BottomNavBar({super.key, required this.currentIndex});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: LanguageService(),
      builder: (context, child) {
        final lang = LanguageService();
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(32),
              topRight: Radius.circular(32),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 30,
                offset: const Offset(0, -10),
              ),
            ],
          ),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _buildNavItem(context, imagePath: 'assets/images/apps.png', label: lang.getString('home'), index: 0, route: AppRoutes.home),
                  _buildNavItem(context, imagePath: 'assets/images/writing.png', label: lang.getString('writing_practice').split(' ').first, index: 1, route: AppRoutes.writing),
                  _buildNavItem(context, imagePath: 'assets/images/ai-coach-icon.png', label: lang.getString('ai_coach').split(' ').last, index: 2, route: AppRoutes.aiCoach),
                  _buildNavItem(context, imagePath: 'assets/images/user.png', label: lang.getString('profile'), index: 3, route: AppRoutes.profile),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildNavItem(BuildContext context, {required String imagePath, required String label, required int index, required String route}) {
    final isSelected = currentIndex == index;
    
    return GestureDetector(
      onTap: () {
        if (!isSelected) {
          Navigator.pushReplacementNamed(context, route);
        }
      },
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutBack,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primaryColor.withValues(alpha: 0.1) : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Opacity(
              opacity: isSelected ? 1.0 : 0.5,
              child: Image.asset(
                imagePath,
                width: 24,
                height: 24,
              ),
            ),
            if (isSelected) ...[
              const SizedBox(height: 4),
              Text(
                label,
                style: const TextStyle(
                  color: AppTheme.primaryColor,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
            ]
          ],
        ),
      ),
    );
  }
}
