import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'core/routes/app_routes.dart';
import 'services/auth_service.dart';

class LinguaAIApp extends StatelessWidget {
  const LinguaAIApp({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = AuthService();
    final String initial = (auth.isLoggedIn || auth.isGuest) ? AppRoutes.home : AppRoutes.login;

    return MaterialApp(
      title: 'LinguAi',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      initialRoute: initial,
      routes: AppRoutes.getRoutes(),
    );
  }
}
