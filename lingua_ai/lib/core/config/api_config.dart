import 'package:flutter/foundation.dart';
import 'dart:io' show Platform;

class ApiConfig {
  // Set this to your computer's local IP address when testing on a physical device.
  // You can find your computer's IP address by running 'ipconfig' (currently 192.168.1.100).
  static const String localComputerIp = '192.168.1.100';

  // Set this to true if testing on an emulator, or false for a physical device.
  // Since you are running on your physical phone, we set this to false so it connects to your PC.
  static const bool isEmulator = false;

  static String get baseUrl {
    const envUrl = String.fromEnvironment('API_URL');
    if (envUrl.isNotEmpty) {
      return envUrl;
    }
    if (kIsWeb) {
      return 'http://localhost:3000';
    }
    try {
      if (isEmulator) {
        if (Platform.isAndroid) {
          return 'http://10.0.2.2:3000';
        }
        return 'http://localhost:3000';
      } else {
        return 'http://$localComputerIp:3000';
      }
    } catch (e) {
      // Fallback
    }
    return 'http://$localComputerIp:3000';
  }

  static const String lessons = '/lessons';
  static const String authRegister = '/auth/register';
  static const String authLogin = '/auth/login';
  static const String authGuest = '/auth/guest';
  static const String progress = '/progress';
  static const String aiCoach = '/ai-coach';
  static const String flashcards = '/flashcards';
}
