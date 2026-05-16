import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';

class CustomTextField extends StatelessWidget {
  final String hintText;
  final bool isPassword;
  final IconData? prefixIcon;
  final TextEditingController? controller;

  const CustomTextField({
    super.key,
    required this.hintText,
    this.isPassword = false,
    this.prefixIcon,
    this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: TextFormField(
        controller: controller,
        obscureText: isPassword,
        style: const TextStyle(color: AppTheme.textPrimaryColor, fontWeight: FontWeight.w500),
        decoration: InputDecoration(
          hintText: hintText,
          prefixIcon: prefixIcon != null ? Icon(prefixIcon, color: AppTheme.textSecondaryColor) : null,
        ),
      ),
    );
  }
}
