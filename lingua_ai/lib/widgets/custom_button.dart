import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';

class CustomButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final bool isOutlined;
  final bool isLoading;

  const CustomButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.isOutlined = false,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    if (isOutlined) {
      return OutlinedButton(
        onPressed: isLoading ? null : onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: AppTheme.textPrimaryColor,
          side: BorderSide(color: AppTheme.textSecondaryColor.withValues(alpha: 0.3), width: 2),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 18),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
        child: _buildChild(AppTheme.textPrimaryColor),
      );
    }

    return Container(
      decoration: BoxDecoration(
        gradient: onPressed == null ? null : AppTheme.primaryGradient,
        borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
        boxShadow: onPressed == null ? [] : AppTheme.softShadow,
      ),
      child: ElevatedButton(
        onPressed: isLoading ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.transparent,
          shadowColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.buttonRadius),
          ),
        ),
        child: _buildChild(Colors.white),
      ),
    );
  }

  Widget _buildChild(Color progressColor) {
    if (isLoading) {
      return SizedBox(
        height: 20,
        width: 20,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(progressColor),
        ),
      );
    }
    return Text(text);
  }
}
