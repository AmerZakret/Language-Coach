import 'package:flutter/material.dart';
import 'app.dart';
import 'services/progress_service.dart';
import 'services/flashcard_service.dart';
import 'core/localization/language_service.dart';
import 'core/localization/target_language_service.dart';
import 'services/auth_service.dart';
import 'services/sound_service.dart';
import 'services/theme_service.dart';
import 'services/connectivity_service.dart';
import 'services/sync_coordinator.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await ConnectivityService().init();
  await ThemeService().init();
  await LanguageService().init();
  await TargetLanguageService().init();
  await AuthService().init();
  await ProgressService().init();
  await SoundService().init();
  await FlashcardService().init();
  final coordinator = SyncCoordinator();
  coordinator.onChanged = (success) {
    ProgressService().syncWithBackend();
    if (success) FlashcardService().syncWithBackend();
  };
  coordinator.start();

  runApp(const LinguaAIApp());
}
