import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:lingua_ai/services/theme_service.dart';

class AppTheme {
  static bool get _isDark => ThemeService().isDarkMode;

  // Palette colors
  static const Color primaryColor = Color(0xFF6366F1); // Indigo
  static const Color secondaryColor = Color(0xFF8B5CF6); // Violet
  static const Color accentColor = Color(0xFF10B981); // Emerald
  static const Color errorColor = Color(0xFFEF4444); // Red

  // Dynamic colors
  static Color get surfaceColor => _isDark ? const Color(0xFF11172A) : Colors.white;
  static Color get backgroundColor => _isDark ? const Color(0xFF0B1020) : const Color(0xFFF8FAFC);
  static Color get primaryLight => _isDark ? const Color(0xFF1D2540) : const Color(0xFFEEF2FF);
  static Color get textPrimary => _isDark ? const Color(0xFFF8FAFC) : const Color(0xFF0F172A);
  static Color get textSecondary => _isDark ? const Color(0xFFCBD5E1) : const Color(0xFF64748B);
  
  // Aliases for backward compatibility
  static Color get textPrimaryColor => textPrimary;
  static Color get textSecondaryColor => textSecondary;
  static const double cardRadius = 24.0;
  static const double buttonRadius = 16.0;
  static const double standardPadding = 24.0;

  // Gradients
  static LinearGradient get premiumGradient => _isDark
      ? const LinearGradient(
          colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        )
      : const LinearGradient(
          colors: [Color(0xFF4F46E5), Color(0xFF9333EA)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );

  static LinearGradient get primaryGradient => premiumGradient;
  static LinearGradient get backgroundGradient => _isDark
      ? const LinearGradient(
          colors: [Color(0xFF0B1020), Color(0xFF11172A)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        )
      : const LinearGradient(
          colors: [Color(0xFFF8FAFC), Color(0xFFEEF2FF)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        );

  static LinearGradient get glassGradient => _isDark
      ? LinearGradient(
          colors: [const Color(0xFF171E33).withValues(alpha: 0.8), const Color(0xFF11172A).withValues(alpha: 0.4)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        )
      : const LinearGradient(
          colors: [Colors.white70, Colors.white10],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        );

  // Shadows
  static List<BoxShadow> get glassShadow => _isDark
      ? [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ]
      : [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 20,
            offset: const Offset(0, 10),
          ),
        ];

  static List<BoxShadow> get softShadow => glassShadow;
  static List<BoxShadow> get cardShadow => _isDark
      ? [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.2),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ]
      : [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ];

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: primaryColor,
        primary: primaryColor,
        secondary: secondaryColor,
        surface: Colors.white,
        error: errorColor,
      ),
      scaffoldBackgroundColor: const Color(0xFFF8FAFC),
      textTheme: GoogleFonts.outfitTextTheme().copyWith(
        displayLarge: GoogleFonts.outfit(fontWeight: FontWeight.w900, color: const Color(0xFF0F172A)),
        headlineMedium: GoogleFonts.outfit(fontWeight: FontWeight.w800, color: const Color(0xFF0F172A)),
        titleLarge: GoogleFonts.outfit(fontWeight: FontWeight.w700, color: const Color(0xFF0F172A)),
        bodyLarge: GoogleFonts.outfit(color: const Color(0xFF0F172A), fontSize: 16),
        bodyMedium: GoogleFonts.outfit(color: const Color(0xFF64748B), fontSize: 14),
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

  static ThemeData get darkTheme {
    const darkSurface = Color(0xFF11172A);
    const darkBg = Color(0xFF0B1020);
    const darkTextPrimary = Color(0xFFF8FAFC);
    const darkTextSecondary = Color(0xFFCBD5E1);

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: primaryColor,
        secondary: secondaryColor,
        surface: darkSurface,
        error: errorColor,
      ),
      scaffoldBackgroundColor: darkBg,
      textTheme: GoogleFonts.outfitTextTheme(ThemeData.dark().textTheme).copyWith(
        displayLarge: GoogleFonts.outfit(fontWeight: FontWeight.w900, color: darkTextPrimary),
        headlineMedium: GoogleFonts.outfit(fontWeight: FontWeight.w800, color: darkTextPrimary),
        titleLarge: GoogleFonts.outfit(fontWeight: FontWeight.w700, color: darkTextPrimary),
        bodyLarge: GoogleFonts.outfit(color: darkTextPrimary, fontSize: 16),
        bodyMedium: GoogleFonts.outfit(color: darkTextSecondary, fontSize: 14),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        iconTheme: IconThemeData(color: Colors.white),
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
