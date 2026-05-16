import 'package:flutter/material.dart';
import 'app.dart';
import 'services/progress_service.dart';
import 'core/localization/language_service.dart';
import 'core/localization/target_language_service.dart';
import 'services/auth_service.dart';
import 'services/sound_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  await LanguageService().init();
  await TargetLanguageService().init();
  await ProgressService().init();
  await AuthService().init();
  await SoundService().init();
  
  runApp(const LinguaAIApp());
}
