import 'package:flutter/material.dart';

import '../../screens/auth/login_screen.dart';
import '../../screens/auth/register_screen.dart';
import '../../screens/home/home_screen.dart';
import '../../screens/lessons/lesson_screen.dart';
import '../../screens/lessons/lesson_result_screen.dart';
import '../../screens/coach/ai_coach_screen.dart';
import '../../screens/profile/profile_screen.dart';

class AppRoutes {
  static const String login = '/login';
  static const String register = '/register';
  static const String home = '/home';
  static const String lesson = '/lesson';
  static const String lessonResult = '/lesson-result';
  static const String aiCoach = '/ai-coach';
  static const String profile = '/profile';

  static Map<String, WidgetBuilder> getRoutes() {
    return {
      login: (context) => const LoginScreen(),
      register: (context) => const RegisterScreen(),
      home: (context) => const HomeScreen(),
      lesson: (context) => const LessonScreen(),
      lessonResult: (context) => const LessonResultScreen(),
      aiCoach: (context) => const AiCoachScreen(),
      profile: (context) => const ProfileScreen(),
    };
  }
}
