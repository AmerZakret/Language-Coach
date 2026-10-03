import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../models/flashcard.dart';
import '../../services/flashcard_service.dart';
import '../../services/theme_service.dart';

class FlashcardsScreen extends StatefulWidget {
  const FlashcardsScreen({super.key});

  @override
  State<FlashcardsScreen> createState() => _FlashcardsScreenState();
}

class _FlashcardsScreenState extends State<FlashcardsScreen> {
  final _service = FlashcardService();
  bool _loading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _refreshCards();
  }

  Future<void> _refreshCards() async {
    setState(() {
      _loading = true;
      _errorMessage = null;
    });
    try {
      await _service.reloadFlashcards();
    } catch (e) {
      setState(() {
        _errorMessage = 'Failed to load flashcards: $e';
      });
    } finally {
      setState(() {
        _loading = false;
      });
    }
  }

  void _showAddEditDialog({Flashcard? card}) {
    final isEdit = card != null;
    final wordController = TextEditingController(text: card?.targetWord ?? '');
    final translationController = TextEditingController(text: card?.turkishTranslation ?? '');
    final exampleController = TextEditingController(text: card?.exampleSentence ?? '');
    final noteController = TextEditingController(text: card?.note ?? '');

    showDialog(
      context: context,
      builder: (context) {
        final lang = LanguageService();
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          title: Text(
            isEdit ? 'Edit Flashcard' : 'Add New Flashcard',
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: wordController,
                  decoration: const InputDecoration(
                    labelText: 'English Word *',
                    hintText: 'e.g. hello',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: translationController,
                  decoration: const InputDecoration(
                    labelText: 'Turkish Translation *',
                    hintText: 'e.g. merhaba',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: exampleController,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Example Sentence (Optional)',
                    hintText: 'e.g. Say hello to your friend.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: noteController,
                  decoration: const InputDecoration(
                    labelText: 'Note (Optional)',
                    hintText: 'e.g. informal greeting',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(lang.getString('cancel'), style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            ElevatedButton(
              onPressed: () async {
                final word = wordController.text.trim();
                final translation = translationController.text.trim();
                if (word.isEmpty || translation.isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(lang.getString('fields_empty_error'))),
                  );
                  return;
                }

                Navigator.pop(context);
                setState(() => _loading = true);

                try {
                  if (isEdit) {
                    await _service.updateFlashcard(
                      card.id,
                      word,
                      translation,
                      exampleSentence: exampleController.text.trim(),
                      note: noteController.text.trim(),
                    );
                    _showSuccessSnackBar(lang.getString('flashcard_updated_success'));
                  } else {
                    await _service.createFlashcard(
                      word,
                      translation,
                      exampleSentence: exampleController.text.trim(),
                      note: noteController.text.trim(),
                    );
                    _showSuccessSnackBar(lang.getString('flashcard_added_success'));
                  }
                  _refreshCards();
                } catch (e) {
                  setState(() => _errorMessage = '${lang.getString('failed_save_card')}: $e');
                } finally {
                  setState(() => _loading = false);
                }
              },
              child: Text(lang.getString('save'), style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  void _showDeleteConfirmation(String cardId) {
    final lang = LanguageService();
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          title: Text(lang.getString('delete_flashcard_title'), style: const TextStyle(fontWeight: FontWeight.w900)),
          content: Text(lang.getString('confirm_delete_card')),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(lang.getString('cancel'), style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.errorColor, foregroundColor: Colors.white),
              onPressed: () async {
                Navigator.pop(context);
                setState(() => _loading = true);
                try {
                  await _service.deleteFlashcard(cardId);
                  _showSuccessSnackBar(lang.getString('flashcard_deleted_success'));
                  _refreshCards();
                } catch (e) {
                  setState(() => _errorMessage = '${lang.getString('failed_delete_card')}: $e');
                } finally {
                  setState(() => _loading = false);
                }
              },
              child: Text(lang.getString('delete'), style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  void _showSuccessSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([LanguageService(), TargetLanguageService(), ThemeService()]),
      builder: (context, child) {
        final lang = LanguageService();
        final targetLang = TargetLanguageService();

        return Scaffold(
          appBar: AppBar(
            title: Text(
              lang.getString('flashcards'),
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 22, color: AppTheme.textPrimary),
            ),
            actions: [
              IconButton(
                icon: const Icon(Icons.refresh_rounded),
                onPressed: _refreshCards,
              ),
            ],
          ),
          body: SafeArea(
            child: ListenableBuilder(
              listenable: _service,
              builder: (context, child) {
                final cards = _service.allCards;
                final due = _service.dueCards;

                if (_loading && cards.isEmpty) {
                  return const Center(child: CircularProgressIndicator());
                }

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Top control bar
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: _buildInfoBadge(
                              title: 'Total Deck',
                              value: '${cards.length} cards',
                              color: AppTheme.primaryColor,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _buildInfoBadge(
                              title: 'Due Today',
                              value: '${due.length} cards',
                              color: due.isNotEmpty ? Colors.green : AppTheme.textSecondaryColor,
                            ),
                          ),
                        ],
                      ),
                    ),

                    if (_errorMessage != null)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppTheme.errorColor.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: AppTheme.errorColor.withValues(alpha: 0.2)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.error_outline_rounded, color: AppTheme.errorColor),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  _errorMessage!,
                                  style: const TextStyle(color: AppTheme.errorColor, fontWeight: FontWeight.w600, fontSize: 13),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                    // Main deck list
                    Expanded(
                      child: cards.isEmpty
                          ? _buildEmptyState(lang)
                          : ListView.builder(
                              physics: const BouncingScrollPhysics(),
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 80),
                              itemCount: cards.length,
                              itemBuilder: (context, index) {
                                final card = cards[index];
                                final isDue = due.any((d) => d.id == card.id);
                                return _buildCardItem(card, isDue, targetLang);
                              },
                            ),
                    ),
                  ],
                );
              },
            ),
          ),
          floatingActionButton: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListenableBuilder(
                listenable: _service,
                builder: (context, child) {
                  if (_service.dueCards.isEmpty) return const SizedBox.shrink();
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: FloatingActionButton.extended(
                      heroTag: 'studyBtn',
                      onPressed: () {
                        Navigator.pushNamed(context, AppRoutes.flashcardsReview).then((_) => _refreshCards());
                      },
                      backgroundColor: Colors.green,
                      foregroundColor: Colors.white,
                      icon: const Icon(Icons.play_arrow_rounded),
                      label: Text('Study Due (${_service.dueCards.length})', style: const TextStyle(fontWeight: FontWeight.w800)),
                    ),
                  );
                },
              ),
              FloatingActionButton.extended(
                heroTag: 'addBtn',
                onPressed: () => _showAddEditDialog(),
                backgroundColor: AppTheme.primaryColor,
                foregroundColor: Colors.white,
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add Card', style: TextStyle(fontWeight: FontWeight.w800)),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildInfoBadge({required String title, required String value, required Color color}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: ThemeService().isDarkMode ? 0.15 : 0.08),
        border: Border.all(color: color.withValues(alpha: ThemeService().isDarkMode ? 0.3 : 0.15)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: color.withValues(alpha: 0.8), letterSpacing: 0.5),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: color),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState(LanguageService lang) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppTheme.primaryColor.withValues(alpha: ThemeService().isDarkMode ? 0.15 : 0.08),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.style_rounded, size: 48, color: AppTheme.primaryColor),
          ),
          const SizedBox(height: 24),
          Text(
            'No flashcards yet',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 8),
          Text(
            'Add your first card. Custom words will appear here for structured learning review.',
            style: TextStyle(fontSize: 14, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildCardItem(Flashcard card, bool isDue, TargetLanguageService targetLang) {
    return FlashcardListItem(
      card: card,
      isDue: isDue,
      targetLang: targetLang,
      onEdit: () => _showAddEditDialog(card: card),
      onDelete: () => _showDeleteConfirmation(card.id),
    );
  }
}

class FlashcardListItem extends StatefulWidget {
  final Flashcard card;
  final bool isDue;
  final TargetLanguageService targetLang;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const FlashcardListItem({
    super.key,
    required this.card,
    required this.isDue,
    required this.targetLang,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<FlashcardListItem> createState() => _FlashcardListItemState();
}

class _FlashcardListItemState extends State<FlashcardListItem> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  bool _isFlipped = false;
  final FlutterTts _flutterTts = FlutterTts();

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );
    _animation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: _toggleCard,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        height: 220,
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
                      child: _buildCardBack(),
                    )
                  : _buildCardFront(),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCardFront() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(
          color: widget.isDue
              ? Colors.green.withValues(alpha: 0.4)
              : (ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.grey.shade100),
          width: widget.isDue ? 1.5 : 1.0,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: widget.isDue
                      ? Colors.green.withValues(alpha: 0.15)
                      : (ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.grey.shade100),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  widget.isDue ? 'DUE NOW' : 'LEARNING',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: widget.isDue ? Colors.green : AppTheme.textSecondaryColor,
                  ),
                ),
              ),
              Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.edit_rounded, size: 18),
                    color: AppTheme.textSecondaryColor,
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.all(6),
                    onPressed: widget.onEdit,
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline_rounded, size: 18),
                    color: AppTheme.errorColor.withValues(alpha: 0.8),
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.all(6),
                    onPressed: widget.onDelete,
                  ),
                ],
              ),
            ],
          ),
          const Expanded(child: SizedBox.shrink()),
          Center(
            child: Text(
              widget.card.targetWord,
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
              textAlign: TextAlign.center,
            ),
          ),
          const Expanded(child: SizedBox.shrink()),
          Center(
            child: Text(
              'Tap card to flip',
              style: TextStyle(fontSize: 10, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCardBack() {
    final translation = widget.card.turkishTranslation.isNotEmpty ? widget.card.turkishTranslation : 'No translation';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(
          color: widget.isDue
              ? Colors.green.withValues(alpha: 0.4)
              : (ThemeService().isDarkMode ? Colors.white.withValues(alpha: 0.08) : Colors.grey.shade100),
          width: widget.isDue ? 1.5 : 1.0,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
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
              IconButton(
                icon: Icon(Icons.volume_up_rounded, color: AppTheme.textSecondaryColor, size: 18),
                constraints: const BoxConstraints(),
                padding: const EdgeInsets.all(6),
                onPressed: () => _speak(translation, 'tr-TR'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(
                children: [
                  Text(
                    translation,
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppTheme.textPrimary),
                    textAlign: TextAlign.center,
                  ),
                  if (widget.card.exampleSentence != null && widget.card.exampleSentence!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppTheme.backgroundColor,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '"${widget.card.exampleSentence}"',
                        style: TextStyle(fontSize: 11, fontStyle: FontStyle.italic, color: AppTheme.textPrimary),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                  if (widget.card.note != null && widget.card.note!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.info_outline_rounded, size: 12, color: AppTheme.textSecondaryColor),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            widget.card.note!,
                            style: TextStyle(fontSize: 11, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w500),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Divider(height: 1),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.calendar_month_rounded, size: 12, color: AppTheme.textSecondaryColor),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        'Next: ${widget.card.nextReviewDate.month}/${widget.card.nextReviewDate.day}/${widget.card.nextReviewDate.year}',
                        style: TextStyle(fontSize: 10, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'Reviews: ${widget.card.reviewCount}',
                style: TextStyle(fontSize: 10, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
