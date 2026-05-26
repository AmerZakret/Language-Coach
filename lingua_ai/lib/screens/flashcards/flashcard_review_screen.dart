import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../models/flashcard.dart';
import '../../services/flashcard_service.dart';
import 'package:flutter_tts/flutter_tts.dart';

class FlashcardReviewScreen extends StatefulWidget {
  const FlashcardReviewScreen({super.key});

  @override
  State<FlashcardReviewScreen> createState() => _FlashcardReviewScreenState();
}

class _FlashcardReviewScreenState extends State<FlashcardReviewScreen> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  
  int _currentIndex = 0;
  bool _isFlipped = false;
  bool _isDone = false;
  
  final List<int> _results = [];
  List<Flashcard> _dueCards = [];
  List<Flashcard> _originalCards = [];

  // Play/Shuffle/Star/Hint states
  bool _isPlaying = false;
  bool _isShuffled = false;
  Timer? _slideshowTimer;
  final Set<String> _starredCardIds = {};
  bool _hintVisible = false;
  final FlutterTts _flutterTts = FlutterTts();

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 500),
    );
    _animation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
    
    // Get due cards from service
    _dueCards = List.from(FlashcardService().dueCards);
    _originalCards = List.from(FlashcardService().dueCards);
  }

  @override
  void dispose() {
    _controller.dispose();
    _slideshowTimer?.cancel();
    super.dispose();
  }

  Future<void> _speak(String text, String langCode) async {
    try {
      await _flutterTts.setLanguage(langCode);
      await _flutterTts.setPitch(1.0);
      await _flutterTts.setSpeechRate(0.5);
      await _flutterTts.speak(text);
    } catch (e) {
      debugPrint('Error using TTS: $e');
    }
  }

  void _toggleCard() {
    if (_isFlipped) {
      _controller.reverse();
    } else {
      _controller.forward();
    }
    setState(() {
      _isFlipped = !_isFlipped;
    });
  }

  Future<void> _handleScore(int score, {bool manual = true}) async {
    final currentCard = _dueCards[_currentIndex];
    _results.add(score);

    // Call service to update SRS parameters
    await FlashcardService().reviewCard(currentCard, score);

    if (_currentIndex + 1 >= _dueCards.length) {
      _stopSlideshow();
      setState(() {
        _isDone = true;
      });
    } else {
      setState(() {
        _currentIndex++;
        _isFlipped = false;
        _hintVisible = false;
      });
      _controller.reset();
    }
  }

  void _startSlideshow() {
    setState(() {
      _isPlaying = true;
    });
    _slideshowTimer = Timer.periodic(const Duration(seconds: 4), (timer) {
      if (!_isFlipped) {
        _toggleCard();
      } else {
        // Auto pass with score 4
        _handleScore(4, manual: false);
      }
    });
  }

  void _stopSlideshow() {
    _slideshowTimer?.cancel();
    setState(() {
      _isPlaying = false;
    });
  }

  void _toggleShuffle() {
    setState(() {
      if (_isShuffled) {
        _dueCards = List.from(_originalCards);
        _isShuffled = false;
      } else {
        _dueCards.shuffle();
        _isShuffled = true;
      }
      _currentIndex = 0;
      _isFlipped = false;
      _hintVisible = false;
      _controller.reset();
    });
  }

  void _toggleStar(String cardId) {
    setState(() {
      if (_starredCardIds.contains(cardId)) {
        _starredCardIds.remove(cardId);
      } else {
        _starredCardIds.add(cardId);
      }
    });
  }

  void _goNextCard() {
    if (_currentIndex + 1 < _dueCards.length) {
      setState(() {
        _currentIndex++;
        _isFlipped = false;
        _hintVisible = false;
      });
      _controller.reset();
    }
  }

  void _goPrevCard() {
    if (_currentIndex > 0) {
      setState(() {
        _currentIndex--;
        _isFlipped = false;
        _hintVisible = false;
      });
      _controller.reset();
    }
  }

  String _getHintText(Flashcard card) {
    if (card.note != null && card.note!.isNotEmpty) {
      return 'Note: ${card.note}';
    }
    if (card.turkishTranslation.isNotEmpty) {
      final len = card.turkishTranslation.length;
      final showLen = len > 2 ? 2 : len;
      return 'Starts with: "${card.turkishTranslation.substring(0, showLen)}..."';
    }
    return 'No hint available';
  }

  Widget _buildCardFront(Flashcard card, String targetLang) {
    final isStarred = _starredCardIds.contains(card.id);
    return Container(
      key: const ValueKey('front'),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(32),
        border: Border.all(color: Colors.grey.shade200, width: 1),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Header inside card
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton.icon(
                onPressed: () {
                  setState(() {
                    _hintVisible = !_hintVisible;
                  });
                },
                icon: const Icon(Icons.lightbulb_outline_rounded, color: Colors.orange, size: 16),
                label: const Text(
                  'Get a hint',
                  style: TextStyle(color: AppTheme.textSecondaryColor, fontSize: 13, fontWeight: FontWeight.bold),
                ),
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: Size.zero),
              ),
              Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.volume_up_rounded, color: AppTheme.textSecondaryColor, size: 20),
                    onPressed: () => _speak(card.targetWord, 'en-US'),
                  ),
                  IconButton(
                    icon: Icon(
                      isStarred ? Icons.star_rounded : Icons.star_outline_rounded,
                      color: isStarred ? Colors.amber : AppTheme.textSecondaryColor,
                      size: 20,
                    ),
                    onPressed: () => _toggleStar(card.id),
                  ),
                ],
              ),
            ],
          ),

          // Central target word
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  card.targetWord,
                  style: const TextStyle(
                    fontSize: 34,
                    fontWeight: FontWeight.w900,
                    color: AppTheme.textPrimaryColor,
                    letterSpacing: -0.5,
                  ),
                  textAlign: TextAlign.center,
                ),
                if (_hintVisible) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.orange.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.orange.withValues(alpha: 0.15)),
                    ),
                    child: Text(
                      _getHintText(card),
                      style: const TextStyle(color: Colors.orange, fontSize: 12, fontWeight: FontWeight.bold),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Tap feedback
          const Text(
            'Tap card to flip',
            style: TextStyle(fontSize: 11, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  Widget _buildCardBack(Flashcard card) {
    final translation = card.turkishTranslation.isNotEmpty ? card.turkishTranslation : 'No translation';
    final isStarred = _starredCardIds.contains(card.id);

    return Container(
      key: const ValueKey('back'),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(32),
        border: Border.all(color: Colors.grey.shade200, width: 1),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // Header inside card
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'TRANSLATION',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                  color: AppTheme.primaryColor,
                  letterSpacing: 1.2,
                ),
              ),
              Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.volume_up_rounded, color: AppTheme.textSecondaryColor, size: 20),
                    onPressed: () => _speak(translation, 'tr-TR'),
                  ),
                  IconButton(
                    icon: Icon(
                      isStarred ? Icons.star_rounded : Icons.star_outline_rounded,
                      color: isStarred ? Colors.amber : AppTheme.textSecondaryColor,
                      size: 20,
                    ),
                    onPressed: () => _toggleStar(card.id),
                  ),
                ],
              ),
            ],
          ),

          // Central translation
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const SizedBox(height: 12),
                  Text(
                    translation,
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w900,
                      color: AppTheme.textPrimaryColor,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  if (card.exampleSentence != null && card.exampleSentence!.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.backgroundColor,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Example',
                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.textSecondaryColor),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '"${card.exampleSentence}"',
                            style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppTheme.textPrimaryColor),
                          ),
                        ],
                      ),
                    ),
                  if (card.note != null && card.note!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppTheme.backgroundColor,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Note',
                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.textSecondaryColor),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            card.note!,
                            style: const TextStyle(fontSize: 12, color: AppTheme.textPrimaryColor),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Tap feedback
          const Text(
            'Tap card to flip',
            style: TextStyle(fontSize: 11, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lang = LanguageService();
    final targetLang = TargetLanguageService();

    if (_dueCards.isEmpty) {
      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: const BoxDecoration(
                    gradient: AppTheme.premiumGradient,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.auto_awesome_rounded,
                    color: Colors.white,
                    size: 36,
                  ),
                ),
                const SizedBox(height: 32),
                Text(
                  lang.getString('all_caught_up'),
                  style: const TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                    color: AppTheme.textPrimaryColor,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  lang.getString('no_cards_due'),
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppTheme.textSecondaryColor,
                    fontWeight: FontWeight.w500,
                    height: 1.5,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 40),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    child: Text(
                      lang.getString('back_to_dashboard'),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (_isDone) {
      final avgScore = _results.isEmpty ? 0.0 : _results.reduce((a, b) => a + b) / _results.length;

      return Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppTheme.accentColor, Colors.teal.shade400],
                    ),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.check_rounded, color: Colors.white, size: 40),
                ),
                const SizedBox(height: 32),
                const Text(
                  'Great Job!',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppTheme.textPrimaryColor),
                ),
                const SizedBox(height: 8),
                Text(
                  "You've reviewed all ${_dueCards.length} cards for today.",
                  style: const TextStyle(fontSize: 15, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
                  decoration: BoxDecoration(
                    color: AppTheme.accentColor.withValues(alpha: 0.1),
                    border: Border.all(color: AppTheme.accentColor.withValues(alpha: 0.2)),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Column(
                    children: [
                      Text(
                        '${avgScore.toStringAsFixed(1)} / 5',
                        style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w900, color: AppTheme.accentColor),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Average Score',
                        style: TextStyle(fontSize: 12, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 48),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(context),
                    child: Text(
                      lang.getString('back_to_dashboard'),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final card = _dueCards[_currentIndex];
    final progressVal = _dueCards.isNotEmpty ? _currentIndex / _dueCards.length : 0.0;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          children: [
            Text(
              lang.getString('flashcards'),
              style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20),
            ),
            Text(
              '${_dueCards.length} due today',
              style: const TextStyle(fontSize: 11, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Study Card Container
              Expanded(
                child: Center(
                  child: GestureDetector(
                    onTap: _toggleCard,
                    child: AspectRatio(
                      aspectRatio: 0.85,
                      child: AnimatedBuilder(
                        animation: _animation,
                        builder: (context, child) {
                          final angle = _animation.value * math.pi;
                          final isBack = angle >= math.pi / 2;

                          final transform = Matrix4.identity()
                            ..setEntry(3, 2, 0.001) // perspective
                            ..rotateY(angle);

                          return Transform(
                            transform: transform,
                            alignment: Alignment.center,
                            child: isBack
                                ? Transform(
                                    transform: Matrix4.rotationY(math.pi),
                                    alignment: Alignment.center,
                                    child: _buildCardBack(card),
                                  )
                                : _buildCardFront(card, targetLang.currentLanguage),
                          );
                        },
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Rating Panel - Visible only when flipped
              AnimatedSize(
                duration: const Duration(milliseconds: 250),
                child: Container(
                  child: _isFlipped ? _buildRatingPanel(lang) : const SizedBox.shrink(),
                ),
              ),

              // Controls Bar (Play, Shuffle, Prev, Next, Star)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      IconButton(
                        icon: Icon(
                          _isShuffled ? Icons.shuffle_on_rounded : Icons.shuffle_rounded,
                          color: _isShuffled ? AppTheme.primaryColor : AppTheme.textSecondaryColor,
                        ),
                        onPressed: _toggleShuffle,
                      ),
                      IconButton(
                        icon: Icon(
                          _isPlaying ? Icons.pause_circle_filled_rounded : Icons.play_circle_fill_rounded,
                          color: _isPlaying ? AppTheme.primaryColor : AppTheme.textSecondaryColor,
                        ),
                        onPressed: () {
                          if (_isPlaying) {
                            _stopSlideshow();
                          } else {
                            _startSlideshow();
                          }
                        },
                      ),
                    ],
                  ),
                  
                  // Centered Navigation Controls
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.arrow_back_rounded),
                        onPressed: _currentIndex > 0 ? _goPrevCard : null,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '${_currentIndex + 1} / ${_dueCards.length}',
                        style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.textPrimaryColor),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.arrow_forward_rounded),
                        onPressed: _currentIndex + 1 < _dueCards.length ? _goNextCard : null,
                      ),
                    ],
                  ),

                  // Empty slot to keep balance
                  const SizedBox(width: 48),
                ],
              ),
              const SizedBox(height: 12),

              // Linear Progress Bar
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: LinearProgressIndicator(
                  value: progressVal,
                  minHeight: 6,
                  backgroundColor: Colors.grey.shade200,
                  valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.primaryColor),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRatingPanel(LanguageService lang) {
    final labels = ["Forgot", "Hard", "Okay", "Easy", "Very Easy", "Perfect"];
    final colors = [
      AppTheme.errorColor,
      Colors.orange,
      Colors.amber,
      AppTheme.accentColor,
      Colors.cyan,
      AppTheme.primaryColor,
    ];

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppTheme.cardShadow,
      ),
      child: Column(
        children: [
          const Text(
            'How well did you know this word?',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 3,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 1.6,
            children: List.generate(6, (index) {
              final color = colors[index];
              final label = labels[index];
              return InkWell(
                onTap: () => _handleScore(index),
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.08),
                    border: Border.all(color: color.withValues(alpha: 0.15), width: 1.2),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '$index',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color),
                      ),
                      Text(
                        label,
                        style: TextStyle(fontSize: 8, fontWeight: FontWeight.w800, color: color),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }
}
