import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  // Luxury Palette
  static const Color primaryColor = Color(0xFF6366F1); // Indigo
  static const Color secondaryColor = Color(0xFF8B5CF6); // Violet
  static const Color accentColor = Color(0xFF10B981); // Emerald
  static const Color errorColor = Color(0xFFEF4444); // Red
  static const Color surfaceColor = Colors.white;
  static const Color backgroundColor = Color(0xFFF8FAFC);
  static const Color primaryLight = Color(0xFFEEF2FF);
  static const Color textPrimary = Color(0xFF0F172A);
  static const Color textSecondary = Color(0xFF64748B);
  
  // Aliases for backward compatibility
  static const Color textPrimaryColor = textPrimary;
  static const Color textSecondaryColor = textSecondary;
  static const double cardRadius = 24.0;
  static const double buttonRadius = 16.0;
  static const double standardPadding = 24.0;

  // Gradients
  static const LinearGradient premiumGradient = LinearGradient(
    colors: [Color(0xFF4F46E5), Color(0xFF9333EA)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient primaryGradient = premiumGradient;
  static const LinearGradient backgroundGradient = LinearGradient(
    colors: [Color(0xFFF8FAFC), Color(0xFFEEF2FF)],
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
  );

  static const LinearGradient glassGradient = LinearGradient(
    colors: [Colors.white70, Colors.white10],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  // Shadows
  static List<BoxShadow> glassShadow = [
    BoxShadow(
      color: Colors.black.withValues(alpha: 0.05),
      blurRadius: 20,
      offset: const Offset(0, 10),
    ),
  ];

  static List<BoxShadow> softShadow = glassShadow;
  static List<BoxShadow> cardShadow = [
    BoxShadow(
      color: Colors.black.withValues(alpha: 0.04),
      blurRadius: 16,
      offset: const Offset(0, 4),
    ),
  ];

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primaryColor,
        primary: primaryColor,
        secondary: secondaryColor,
        surface: surfaceColor,
        error: errorColor,
      ),
      scaffoldBackgroundColor: backgroundColor,
      textTheme: GoogleFonts.outfitTextTheme().copyWith(
        displayLarge: GoogleFonts.outfit(fontWeight: FontWeight.w900, color: textPrimary),
        headlineMedium: GoogleFonts.outfit(fontWeight: FontWeight.w800, color: textPrimary),
        titleLarge: GoogleFonts.outfit(fontWeight: FontWeight.w700, color: textPrimary),
        bodyLarge: GoogleFonts.outfit(color: textPrimary, fontSize: 16),
        bodyMedium: GoogleFonts.outfit(color: textSecondary, fontSize: 14),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: 0,
        ),
      ),
    );
  }
}
