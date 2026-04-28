import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../widgets/custom_text_field.dart';
import '../../core/localization/language_service.dart';

class AiCoachScreen extends StatelessWidget {
  const AiCoachScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: LanguageService(),
      builder: (context, child) {
        final lang = LanguageService();
        return Scaffold(
          appBar: AppBar(
            title: Text(lang.getString('ai_coach')),
            centerTitle: true,
          ),
          body: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      _buildMessage(
                        text: 'Hello! How can I help you with your English today?',
                        isBot: true,
                      ),
                      const SizedBox(height: 16),
                      _buildMessage(
                        text: 'Can you explain the difference between "in" and "on"?',
                        isBot: false,
                      ),
                      const SizedBox(height: 16),
                      _buildMessage(
                        text: 'Great question! "In" is generally used for enclosed spaces (e.g., in a room, in a box). "On" is used for surfaces (e.g., on the table, on the wall). Would you like some examples?',
                        isBot: true,
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceColor,
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.05),
                        blurRadius: 10,
                        offset: const Offset(0, -4),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: CustomTextField(
                          hintText: lang.getString('type_message'),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Container(
                        decoration: const BoxDecoration(
                          color: AppTheme.primaryColor,
                          shape: BoxShape.circle,
                        ),
                        child: IconButton(
                          icon: const Icon(Icons.send, color: Colors.white),
                          onPressed: () {},
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: const BottomNavBar(currentIndex: 1),
        );
      },
    );
  }

  Widget _buildMessage({required String text, required bool isBot}) {
    return Align(
      alignment: isBot ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 250), // To avoid taking full width
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
        decoration: BoxDecoration(
          color: isBot ? AppTheme.surfaceColor : AppTheme.primaryColor,
          borderRadius: BorderRadius.circular(20).copyWith(
            bottomLeft: isBot ? const Radius.circular(0) : const Radius.circular(20),
            bottomRight: !isBot ? const Radius.circular(0) : const Radius.circular(20),
          ),
          border: isBot ? Border.all(color: AppTheme.backgroundColor, width: 2) : null,
        ),
        child: Text(
          text,
          style: TextStyle(
            color: isBot ? AppTheme.textPrimaryColor : Colors.white,
            fontSize: 16,
          ),
        ),
      ),
    );
  }
}
