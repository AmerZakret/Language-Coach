import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import '../../core/routes/app_routes.dart';
import '../../core/localization/language_service.dart';
import '../../core/localization/target_language_service.dart';
import '../../models/flashcard.dart';
import '../../services/flashcard_service.dart';

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
                    const SnackBar(content: Text('Please fill out all required fields.')),
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
                    _showSuccessSnackBar('Flashcard updated successfully!');
                  } else {
                    await _service.createFlashcard(
                      word,
                      translation,
                      exampleSentence: exampleController.text.trim(),
                      note: noteController.text.trim(),
                    );
                    _showSuccessSnackBar('Flashcard added successfully!');
                  }
                  _refreshCards();
                } catch (e) {
                  setState(() => _errorMessage = 'Failed to save card: $e');
                } finally {
                  setState(() => _loading = false);
                }
              },
              child: const Text('Save', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  void _showDeleteConfirmation(String cardId) {
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          title: const Text('Delete Flashcard?', style: TextStyle(fontWeight: FontWeight.w900)),
          content: const Text('Are you sure you want to permanently delete this card?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.errorColor, foregroundColor: Colors.white),
              onPressed: () async {
                Navigator.pop(context);
                setState(() => _loading = true);
                try {
                  await _service.deleteFlashcard(cardId);
                  _showSuccessSnackBar('Flashcard deleted successfully!');
                  _refreshCards();
                } catch (e) {
                  setState(() => _errorMessage = 'Failed to delete card: $e');
                } finally {
                  setState(() => _loading = false);
                }
              },
              child: const Text('Delete', style: TextStyle(fontWeight: FontWeight.bold)),
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
    final lang = LanguageService();
    final targetLang = TargetLanguageService();

    return Scaffold(
      appBar: AppBar(
        title: Text(
          lang.getString('flashcards'),
          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 22),
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
  }

  Widget _buildInfoBadge({required String title, required String value, required Color color}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        border: Border.all(color: color.withValues(alpha: 0.15)),
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
              color: AppTheme.primaryColor.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.style_rounded, size: 48, color: AppTheme.primaryColor),
          ),
          const SizedBox(height: 24),
          const Text(
            'No flashcards yet',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppTheme.textPrimaryColor),
          ),
          const SizedBox(height: 8),
          const Text(
            'Add your first card. Custom words will appear here for structured learning review.',
            style: TextStyle(fontSize: 14, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildCardItem(Flashcard card, bool isDue, TargetLanguageService targetLang) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: AppTheme.cardShadow,
        border: Border.all(
          color: isDue ? Colors.green.withValues(alpha: 0.3) : Colors.grey.shade100,
          width: isDue ? 1.5 : 1.0,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isDue ? Colors.green.withValues(alpha: 0.1) : Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  isDue ? 'DUE NOW' : 'LEARNING',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                    color: isDue ? Colors.green : AppTheme.textSecondaryColor,
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
                    onPressed: () => _showAddEditDialog(card: card),
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline_rounded, size: 18),
                    color: AppTheme.errorColor.withValues(alpha: 0.8),
                    constraints: const BoxConstraints(),
                    padding: const EdgeInsets.all(6),
                    onPressed: () => _showDeleteConfirmation(card.id),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            card.targetWord,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: AppTheme.textPrimaryColor),
          ),
          Text(
            card.turkishTranslation,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textSecondaryColor),
          ),
          if (card.exampleSentence != null && card.exampleSentence!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppTheme.backgroundColor,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '"${card.exampleSentence}"',
                style: const TextStyle(fontSize: 12, fontStyle: FontStyle.italic, color: AppTheme.textPrimaryColor),
              ),
            ),
          ],
          if (card.note != null && card.note!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.info_outline_rounded, size: 14, color: AppTheme.textSecondaryColor),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    card.note!,
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(Icons.calendar_month_rounded, size: 13, color: AppTheme.textSecondaryColor),
                  const SizedBox(width: 4),
                  Text(
                    'Next: ${card.nextReviewDate.month}/${card.nextReviewDate.day}/${card.nextReviewDate.year}',
                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              Text(
                'Reviews: ${card.reviewCount}',
                style: const TextStyle(fontSize: 11, color: AppTheme.textSecondaryColor, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
