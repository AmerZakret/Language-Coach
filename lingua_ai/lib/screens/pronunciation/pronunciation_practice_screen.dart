import '../../core/localization/target_language.dart';
import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:record/record.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../core/theme/app_theme.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../services/progress_service.dart';
import '../../services/flashcard_service.dart';
import '../../services/pronunciation_service.dart';
import '../../services/theme_service.dart';
import '../../models/flashcard.dart';
import '../../models/pronunciation_assessment_result.dart';

class PronunciationPracticeScreen extends StatefulWidget {
  const PronunciationPracticeScreen({super.key});

  @override
  State<PronunciationPracticeScreen> createState() => _PronunciationPracticeScreenState();
}

class _PronunciationPracticeScreenState extends State<PronunciationPracticeScreen> {
  final FlutterTts _flutterTts = FlutterTts();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final PronunciationService _pronunciationService = PronunciationService();
  
  final TextEditingController _targetTextController = TextEditingController();

  // State Variables
  String _sourceType = 'manual'; // 'manual', 'flashcard'
  String _targetText = '';
  String _nativeTranslation = '';
  
  List<Flashcard> _flashcards = [];
  Flashcard? _selectedFlashcard;
  bool _isLoadingSources = false;

  bool _isRecording = false;
  String? _recordPath;
  bool _isAssessing = false;
  PronunciationAssessmentResult? _result;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadSources();
  }

  @override
  void dispose() {
    _audioRecorder.dispose();
    _targetTextController.dispose();
    _flutterTts.stop();
    super.dispose();
  }

  Future<void> _loadSources() async {
    setState(() => _isLoadingSources = true);
    try {
      // Load Flashcards
      final fetchedFlashcards = FlashcardService().allCards;

      setState(() {
        _flashcards = fetchedFlashcards;
        _isLoadingSources = false;
      });
    } catch (e) {
      debugPrint('Error loading sources for pronunciation: $e');
      setState(() => _isLoadingSources = false);
    }
  }

  void _resetAssessment() {
    setState(() {
      _targetText = '';
      _nativeTranslation = '';
      _selectedFlashcard = null;
      _recordPath = null;
      _result = null;
      _errorMessage = null;
    });
    _targetTextController.clear();
  }

  Future<void> _speak() async {
    if (_targetText.trim().isEmpty) return;
    final targetLang = TargetLanguageService().currentLanguage;
    final ttsCode = TargetLanguage.ttsLocale(targetLang);

    await _flutterTts.setLanguage(ttsCode);
    await _flutterTts.setSpeechRate(0.45); // Slower speech rate for clarity
    await _flutterTts.speak(_targetText);
  }

  Future<void> _startRecording() async {
    setState(() {
      _errorMessage = null;
      _recordPath = null;
      _result = null;
    });

    try {
      // Request mic permission
      bool hasPermission = false;
      if (kIsWeb) {
        hasPermission = await _audioRecorder.hasPermission();
      } else {
        final status = await Permission.microphone.request();
        hasPermission = status.isGranted;
      }

      if (!hasPermission) {
        setState(() {
          _errorMessage = 'Microphone permission was denied. Please enable it in Settings.';
        });
        return;
      }

      String path = '';
      if (!kIsWeb) {
        final tempDir = Directory.systemTemp;
        path = '${tempDir.path}/pronunciation_practice_${DateTime.now().millisecondsSinceEpoch}.m4a';
      }

      await _audioRecorder.start(
        const RecordConfig(
          encoder: kIsWeb ? AudioEncoder.opus : AudioEncoder.aacLc,
          bitRate: 128000,
          sampleRate: 16000,
        ),
        path: path,
      );

      setState(() {
        _isRecording = true;
        _recordPath = path;
      });
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to start recording: $e';
        _isRecording = false;
      });
    }
  }

  Future<void> _stopRecording() async {
    try {
      final path = await _audioRecorder.stop();
      setState(() {
        _isRecording = false;
        _recordPath = path;
      });
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to stop recording: $e';
        _isRecording = false;
      });
    }
  }

  Future<void> _submitForAssessment() async {
    if (_recordPath == null || _targetText.trim().isEmpty || _isAssessing) return;

    setState(() {
      _isAssessing = true;
      _result = null;
      _errorMessage = null;
    });

    final targetLang = TargetLanguageService().currentLanguage;
    final langCode = TargetLanguage.code(targetLang);

    try {
      final assessment = await _pronunciationService.assessPronunciation(
        audioPath: _recordPath!,
        targetText: _targetText,
        targetLanguage: langCode,
        nativeTranslation: _nativeTranslation.isNotEmpty ? _nativeTranslation : null,
        nativeLanguage: 'tr',
        sourceType: _sourceType,
      );

      setState(() {
        _result = assessment;
        _isAssessing = false;
      });

      // Award XP on success
      if (assessment.pronunciationScore >= 70) {
        ProgressService().addXp(10);
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isAssessing = false;
      });
    }
  }

  Color _getResultColor(int score) {
    if (score >= 90) return Colors.green;
    if (score >= 70) return Colors.orange;
    return Colors.red;
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([LanguageService(), TargetLanguageService(), ThemeService()]),
      builder: (context, child) {
        final lang = LanguageService();
        final targetLang = TargetLanguageService().currentLanguage;

        return Scaffold(
          backgroundColor: AppTheme.backgroundColor,
          appBar: AppBar(
            backgroundColor: Colors.transparent,
            elevation: 0,
            leading: IconButton(
              icon: Icon(Icons.arrow_back_rounded, color: AppTheme.textPrimaryColor),
              onPressed: () => Navigator.pop(context),
            ),
            title: Text(
              lang.getString('pronunciation_practice'),
              style: TextStyle(fontWeight: FontWeight.w900, color: AppTheme.textPrimaryColor),
            ),
            centerTitle: true,
          ),
          body: SafeArea(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 1. Source Tab Selector
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: AppTheme.backgroundColor,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: ThemeService().isDarkMode
                            ? Colors.white.withValues(alpha: 0.08)
                            : Colors.grey.shade100,
                      ),
                    ),
                    child: Row(
                      children: [
                        _buildTabItem('manual', lang.getString('manual_input')),
                        _buildTabItem('flashcard', lang.getString('flashcards')),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),

                  // 2. Source Options/Input Forms
                  _buildSourceContentPanel(lang, targetLang),
                  const SizedBox(height: 24),

                  // 3. Audio & Assessment Control Section
                  if (_targetText.trim().isNotEmpty) ...[
                    _buildPracticeControlsPanel(lang),
                    const SizedBox(height: 24),
                  ],

                  // 4. Assessment Results
                  if (_isAssessing)
                    _buildLoadingCard()
                  else if (_errorMessage != null)
                    _buildErrorCard()
                  else if (_result != null)
                    _buildResultCard(lang),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildTabItem(String type, String label) {
    final isSelected = _sourceType == type;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() {
            _sourceType = type;
          });
          _resetAssessment();
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppTheme.surfaceColor : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            boxShadow: isSelected ? AppTheme.cardShadow : null,
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: isSelected ? AppTheme.primaryColor : AppTheme.textSecondaryColor,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSourceContentPanel(LanguageService lang, String targetLang) {
    if (_isLoadingSources) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24.0),
          child: CircularProgressIndicator(color: AppTheme.primaryColor),
        ),
      );
    }

    if (_sourceType == 'manual') {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
            color: ThemeService().isDarkMode
                ? Colors.white.withValues(alpha: 0.08)
                : Colors.grey.shade100,
          ),
          boxShadow: AppTheme.glassShadow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              lang.getString('target_sentence').toUpperCase(),
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondaryColor),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _targetTextController,
              maxLines: 2,
              style: TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: lang.getString('enter_word_sentence').replaceAll('{lang}', TargetLanguageService().getLanguageName(targetLang)),
                hintStyle: TextStyle(color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                border: InputBorder.none,
                fillColor: AppTheme.backgroundColor,
                filled: true,
                contentPadding: const EdgeInsets.all(16),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(
                    color: ThemeService().isDarkMode
                        ? Colors.white.withValues(alpha: 0.08)
                        : Colors.grey.shade100,
                  ),
                ),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: AppTheme.primaryColor)),
              ),
              onChanged: (v) {
                setState(() {
                  _targetText = v;
                });
              },
            ),
            const SizedBox(height: 16),
            Text(
              lang.getString('translation_optional').toUpperCase(),
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondaryColor),
            ),
            const SizedBox(height: 8),
            TextField(
              style: TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: lang.getString('translation_optional_placeholder'),
                hintStyle: TextStyle(color: AppTheme.textSecondary.withValues(alpha: 0.5)),
                border: InputBorder.none,
                fillColor: AppTheme.backgroundColor,
                filled: true,
                contentPadding: const EdgeInsets.all(16),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(
                    color: ThemeService().isDarkMode
                        ? Colors.white.withValues(alpha: 0.08)
                        : Colors.grey.shade100,
                  ),
                ),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: AppTheme.primaryColor)),
              ),
              onChanged: (v) {
                setState(() {
                  _nativeTranslation = v;
                });
              },
            ),
          ],
        ),
      );
    }

    // Flashcard Selection
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: ThemeService().isDarkMode
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.grey.shade100,
        ),
        boxShadow: AppTheme.glassShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            lang.getString('select_flashcard_word').toUpperCase(),
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondaryColor),
          ),
          const SizedBox(height: 8),
          _flashcards.isEmpty
              ? Container(
                  padding: const EdgeInsets.all(16),
                  width: double.infinity,
                  decoration: BoxDecoration(
                    color: AppTheme.backgroundColor,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(
                    lang.getString('no_flashcards_available'),
                    style: TextStyle(color: AppTheme.textSecondaryColor, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                )
              : Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  decoration: BoxDecoration(
                    color: AppTheme.backgroundColor,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: ThemeService().isDarkMode
                          ? Colors.white.withValues(alpha: 0.08)
                          : Colors.grey.shade100,
                    ),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<Flashcard>(
                      value: _selectedFlashcard,
                      isExpanded: true,
                      hint: Text(lang.getString('choose_flashcard')),
                      style: TextStyle(color: AppTheme.textPrimary),
                      dropdownColor: AppTheme.surfaceColor,
                      items: _flashcards.map((card) {
                        return DropdownMenuItem(
                          value: card,
                          child: Text('${card.targetWord} (${card.turkishTranslation})'),
                        );
                      }).toList(),
                      onChanged: (card) {
                        setState(() {
                          _selectedFlashcard = card;
                          _targetText = card?.targetWord ?? '';
                          _nativeTranslation = card?.turkishTranslation ?? '';
                        });
                      },
                    ),
                  ),
                ),
        ],
      ),
    );
  }

  Widget _buildPracticeControlsPanel(LanguageService lang) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: ThemeService().isDarkMode
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.grey.shade100,
        ),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        children: [
          const Text(
            'PRACTICE PHRASE',
            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppTheme.primaryColor, letterSpacing: 1.2),
          ),
          const SizedBox(height: 12),
          Text(
            '"$_targetText"',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppTheme.textPrimary, height: 1.3),
          ),
          if (_nativeTranslation.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              '($_nativeTranslation)',
              style: TextStyle(fontSize: 14, color: AppTheme.textSecondary),
            ),
          ],
          const SizedBox(height: 24),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 16,
            runSpacing: 12,
            children: [
              // Listen Button
              ElevatedButton.icon(
                onPressed: _speak,
                icon: const Icon(Icons.volume_up_rounded, color: AppTheme.primaryColor, size: 18),
                label: Text(lang.getString('listen'), style: TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.bold)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.backgroundColor,
                  elevation: 0,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  side: BorderSide(
                    color: ThemeService().isDarkMode
                        ? Colors.white.withValues(alpha: 0.08)
                        : Colors.grey.shade100,
                  ),
                ),
              ),

              // Record Button
              if (!_isRecording)
                ElevatedButton.icon(
                  onPressed: _startRecording,
                  icon: const Icon(Icons.mic_rounded, color: Colors.white, size: 18),
                  label: Text(lang.getString('record'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppTheme.primaryColor,
                    elevation: 4,
                    shadowColor: AppTheme.primaryColor.withValues(alpha: 0.2),
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                )
              else
                ElevatedButton.icon(
                  onPressed: _stopRecording,
                  icon: const Icon(Icons.stop_rounded, color: Colors.white, size: 18),
                  label: Text(lang.getString('stop'), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red,
                    elevation: 4,
                    shadowColor: Colors.red.withValues(alpha: 0.2),
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                ),
            ],
          ),

          if (_recordPath != null && !_isRecording) ...[
            const SizedBox(height: 24),
            const Divider(height: 1),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _submitForAssessment,
              icon: const Icon(Icons.bolt_rounded, color: Colors.white, size: 18),
              label: const Text('SUBMIT FOR ASSESSMENT', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 0.5)),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primaryColor,
                minimumSize: const Size.fromHeight(56),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                elevation: 4,
                shadowColor: AppTheme.primaryColor.withValues(alpha: 0.2),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildLoadingCard() {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: ThemeService().isDarkMode
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.grey.shade100,
        ),
      ),
      child: Column(
        children: [
          const CircularProgressIndicator(color: AppTheme.primaryColor),
          const SizedBox(height: 20),
          Text(
            'Analyzing speech...',
            style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 4),
          Text(
            'transcribing and generating feedback...',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildErrorCard() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: ThemeService().isDarkMode ? const Color(0xFF4A1515) : const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: Colors.red.withValues(alpha: ThemeService().isDarkMode ? 0.4 : 0.2),
        ),
      ),
      child: Column(
        children: [
          const Icon(Icons.error_outline_rounded, color: Colors.red, size: 36),
          const SizedBox(height: 12),
          const Text('Evaluation Error', style: TextStyle(fontWeight: FontWeight.w900, color: Colors.red, fontSize: 16)),
          const SizedBox(height: 8),
          Text(
            _errorMessage ?? 'An error occurred.',
            style: TextStyle(fontSize: 13, color: ThemeService().isDarkMode ? Colors.red.shade200 : Colors.red.shade900, height: 1.4),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildResultCard(LanguageService lang) {
    final resultColor = _getResultColor(_result!.pronunciationScore);
    
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: ThemeService().isDarkMode
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.grey.shade100,
        ),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'ASSESSMENT RESULT',
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.grey.shade400, letterSpacing: 1.5),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),

          // Score Indicator Ring
          Center(
            child: SizedBox(
              width: 100,
              height: 100,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: CircularProgressIndicator(
                      value: _result!.pronunciationScore / 100,
                      strokeWidth: 8,
                      backgroundColor: AppTheme.backgroundColor,
                      color: resultColor,
                    ),
                  ),
                  Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          '${_result!.pronunciationScore}',
                          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: resultColor),
                        ),
                        Text(
                          _result!.result.toUpperCase().replaceAll('_', ' '),
                          style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: Colors.grey.shade500),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 28),

          // Text Comparisons
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.backgroundColor,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'EXPECTED PHRASE',
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: AppTheme.primaryColor, letterSpacing: 1),
                ),
                const SizedBox(height: 4),
                Text(
                  _result!.targetText,
                  style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.backgroundColor,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'TRANSCRIBED PHRASE',
                  style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: resultColor, letterSpacing: 1),
                ),
                const SizedBox(height: 4),
                Text(
                  _result!.recognizedText.isEmpty ? '(No speech detected)' : _result!.recognizedText,
                  style: TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // Gemini Feedback
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.primaryColor.withValues(alpha: ThemeService().isDarkMode ? 0.1 : 0.03),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.primaryColor.withValues(alpha: ThemeService().isDarkMode ? 0.3 : 0.1)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.auto_awesome_rounded, color: AppTheme.primaryColor, size: 14),
                    SizedBox(width: 6),
                    Text(
                      'AI COACHING FEEDBACK',
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: AppTheme.primaryColor, letterSpacing: 0.5),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _result!.aiFeedback,
                  style: TextStyle(fontSize: 13, height: 1.4, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
                ),
              ],
            ),
          ),

          if (_result!.pronunciationScore >= 70) ...[
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: BoxDecoration(
                color: ThemeService().isDarkMode ? Colors.amber.shade900.withValues(alpha: 0.2) : Colors.amber.shade50,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: ThemeService().isDarkMode ? Colors.amber.shade700.withValues(alpha: 0.4) : Colors.amber.shade200,
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.bolt_rounded, color: Colors.amber, size: 20),
                  const SizedBox(width: 6),
                  Text(
                    'Earned +10 Learning XP!',
                    style: TextStyle(
                      color: ThemeService().isDarkMode ? Colors.amber.shade200 : Colors.amber.shade900,
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
