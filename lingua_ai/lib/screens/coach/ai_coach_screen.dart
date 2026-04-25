import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/bottom_nav_bar.dart';
import '../../widgets/custom_text_field.dart';

class AiCoachScreen extends StatelessWidget {
  const AiCoachScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Coach'),
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
                    text: 'Hola! How can I help you with your Spanish today?',
                    isBot: true,
                  ),
                  const SizedBox(height: 16),
                  _buildMessage(
                    text: 'Can you explain the difference between "por" and "para"?',
                    isBot: false,
                  ),
                  const SizedBox(height: 16),
                  _buildMessage(
                    text: 'Great question! "Por" is generally used for cause, reason, or duration. "Para" is used for purpose, destination, or deadlines. Would you like some examples?',
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
                  const Expanded(
                    child: CustomTextField(
                      hintText: 'Type your message...',
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
