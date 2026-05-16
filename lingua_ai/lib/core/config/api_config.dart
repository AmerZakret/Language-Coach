import 'package:flutter/foundation.dart';
import 'dart:io' show Platform;

class ApiConfig {
  // Use 10.0.2.2 for Android Emulator, localhost for iOS/Web/Desktop
  // For real device, replace with your computer's local IP (e.g., 192.168.1.100)
  static String get baseUrl {
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    try {
      if (Platform.isAndroid) {
        return 'http://10.0.2.2:3000';
      }
    } catch (e) {
      // Fallback for platforms where Platform.isAndroid might throw
    }
    return 'http://localhost:3000';
  }

  static const String lessons = '/lessons';
  static const String authRegister = '/auth/register';
  static const String authLogin = '/auth/login';
  static const String progress = '/progress';
  static const String aiCoach = '/ai-coach';
}
