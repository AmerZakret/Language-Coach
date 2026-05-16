import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../core/localization/language_service.dart';
import '../core/localization/target_language_service.dart';

class TargetLanguageModal extends StatelessWidget {
  const TargetLanguageModal({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: TargetLanguageService(),
      builder: (context, child) {
        final targetLangService = TargetLanguageService();
        final langService = LanguageService();
        
        final languages = ['en', 'es', 'de', 'fr', 'ar'];

        return Container(
          padding: const EdgeInsets.all(32),
          decoration: const BoxDecoration(
            color: AppTheme.surfaceColor,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(32),
              topRight: Radius.circular(32),
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.grey.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                langService.currentLanguage == 'tr' ? 'Öğrenmek İstediğiniz Dil' : 'Learning Language',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: AppTheme.textPrimaryColor,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                langService.currentLanguage == 'tr' ? 'Hangi dili öğrenmek istiyorsunuz?' : 'Which language do you want to learn?',
                style: const TextStyle(
                  fontSize: 16,
                  color: AppTheme.textSecondaryColor,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 32),
              ...languages.map((code) {
                final isSelected = targetLangService.currentLanguage == code;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeInOut,
                    decoration: BoxDecoration(
                      color: isSelected ? AppTheme.primaryColor.withValues(alpha: 0.05) : AppTheme.surfaceColor,
                      border: Border.all(
                        color: isSelected ? AppTheme.primaryColor : Colors.grey.withValues(alpha: 0.2),
                        width: isSelected ? 2 : 1,
                      ),
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                      boxShadow: isSelected ? AppTheme.softShadow : [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.02),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: InkWell(
                      onTap: () {
                        targetLangService.setLanguage(code);
                        Future.delayed(const Duration(milliseconds: 200), () {
                          if (context.mounted) Navigator.pop(context);
                        });
                      },
                      borderRadius: BorderRadius.circular(AppTheme.cardRadius),
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: isSelected ? Colors.white : AppTheme.backgroundColor,
                                shape: BoxShape.circle,
                                boxShadow: isSelected ? [
                                  BoxShadow(
                                    color: AppTheme.primaryColor.withValues(alpha: 0.1),
                                    blurRadius: 8,
                                    offset: const Offset(0, 4),
                                  ),
                                ] : null,
                              ),
                              child: Text(
                                targetLangService.getLanguageFlag(code),
                                style: const TextStyle(fontSize: 28),
                              ),
                            ),
                            const SizedBox(width: 20),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    targetLangService.getLanguageName(code),
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: isSelected ? FontWeight.w900 : FontWeight.w700,
                                      color: isSelected ? AppTheme.primaryColor : AppTheme.textPrimaryColor,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    langService.currentLanguage == 'tr' ? 'Başlangıç dersleri ile başla' : 'Start with beginner lessons',
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: isSelected ? AppTheme.primaryColor.withValues(alpha: 0.7) : AppTheme.textSecondaryColor,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (isSelected)
                              Container(
                                padding: const EdgeInsets.all(4),
                                decoration: const BoxDecoration(
                                  color: AppTheme.primaryColor,
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(Icons.check, color: Colors.white, size: 20),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }
}
