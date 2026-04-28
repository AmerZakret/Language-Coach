import 'package:flutter/material.dart';
import 'app.dart';
import 'services/progress_service.dart';
import 'core/localization/language_service.dart';
import 'services/auth_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  await LanguageService().init();
  await ProgressService().init();
  await AuthService().init();
  
  runApp(const LinguaAIApp());
}
