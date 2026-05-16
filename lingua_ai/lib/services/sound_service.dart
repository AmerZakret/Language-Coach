import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SoundService extends ChangeNotifier {
  static final SoundService _instance = SoundService._internal();
  factory SoundService() => _instance;

  final AudioPlayer _correctPlayer = AudioPlayer();
  final AudioPlayer _wrongPlayer = AudioPlayer();

  bool _isSoundEnabled = true;

  SoundService._internal();

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    _isSoundEnabled = prefs.getBool('sound_enabled') ?? true;
    notifyListeners();
    
    // Preload wav files
    await _correctPlayer.setSource(AssetSource('sounds/correct.wav'));
    await _wrongPlayer.setSource(AssetSource('sounds/wrong.wav'));
  }

  bool get isSoundEnabled => _isSoundEnabled;

  Future<void> toggleSound() async {
    _isSoundEnabled = !_isSoundEnabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('sound_enabled', _isSoundEnabled);
    notifyListeners();
  }

  Future<void> playCorrect() async {
    if (!_isSoundEnabled) return;
    try {
      await _correctPlayer.stop();
      await _correctPlayer.play(AssetSource('sounds/correct.wav'));
    } catch (e) {
      debugPrint('Error playing correct sound: $e');
    }
  }

  Future<void> playWrong() async {
    if (!_isSoundEnabled) return;
    try {
      await _wrongPlayer.stop();
      await _wrongPlayer.play(AssetSource('sounds/wrong.wav'));
    } catch (e) {
      debugPrint('Error playing wrong sound: $e');
    }
  }
}
