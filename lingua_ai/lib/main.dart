import 'core/config/client_protocol.dart';
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
import 'services/offline_queue_service.dart';
import 'core/config/api_config.dart';
import 'services/data_timeline.dart';
import 'services/online_intent_service.dart';
import 'services/direct_mutation_evidence.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  ApiConfig.validateReleaseConfiguration();
  if (!ClientProtocol.validBuildId(ClientProtocol.buildId)) {
    throw StateError('BUILD_ID must be a public identifier of 1 to 96 safe characters.');
  }

  await ThemeService().init();
  await LanguageService().init();
  await TargetLanguageService().init();
  await AuthService().init();
  try {
    // Migrate/check the active owner before progress or sync can consume it.
    await OfflineQueueService().getQueue();
    if (AuthService().token.isNotEmpty) await OnlineIntentService.list();
    await DirectMutationEvidence.list();
    await DataTimeline().load();
  } catch (_) {
    // Never turn unreadable pending work into an empty queue or start replay.
    runApp(const MaterialApp(
        home: Scaffold(
            body: SafeArea(
                child: Center(
      child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Offline work needs storage recovery. Existing files have been preserved.',
            textAlign: TextAlign.center,
          )),
    )))));
    return;
  }
  await ConnectivityService().init();
  await AuthService().fetchLatestProfile();
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
