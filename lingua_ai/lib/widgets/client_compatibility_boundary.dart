import 'package:flutter/material.dart';
import '../services/client_compatibility.dart';
import '../services/data_timeline.dart';
import '../services/online_intent_service.dart';

class ClientCompatibilityBoundary extends StatelessWidget {
  final Widget child;
  const ClientCompatibilityBoundary({super.key, required this.child});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: Listenable.merge([ClientCompatibility(), DataTimeline()]),
    builder: (context, _) => Column(
      children: [
        if (ClientCompatibility().updateRequired)
          const Material(
            color: Color(0xFFFEF3C7),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: EdgeInsets.all(12),
                child: Text(
                  'Client update or pending-work reconciliation is required. Saved work is preserved; mutations are paused.',
                  style: TextStyle(color: Color(0xFF78350F)),
                  textDirection: TextDirection.ltr,
                ),
              ),
            ),
          ),
        if (DataTimeline().recoveryRequired ||
            DataTimeline().hasEvidence ||
            DataTimeline().state == TimelineState.unavailable)
          Material(
            color: const Color(0xFFFEF3C7),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    const Text(
                      'Server history needs reconciliation. Saved actions are preserved. '
                      'Actions from another or an unverified history cannot be sent.',
                      textDirection: TextDirection.ltr,
                    ),
                    TextButton(
                      onPressed: () => _review(context),
                      child: const Text('Review saved online actions'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        Expanded(child: child),
      ],
    ),
  );

  Future<void> _review(BuildContext context) async {
    try {
      final items = await OnlineIntentService.list();
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: const Text('Saved online actions'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Refresh current server history before re-entering an action. '
                    'Discard removes only the selected local record and sends no request.',
                  ),
                  for (final item in items)
                    ListTile(
                      title: Text('${item['kind']} · ${item['language']}'),
                      subtitle: Text(
                        item['dataTimelineId'] == null
                            ? 'Legacy unverified history'
                            : 'History: ${item['dataTimelineId']}',
                      ),
                      trailing:
                          DataTimeline().canDispatch(item['dataTimelineId'])
                          ? null
                          : TextButton(
                              child: const Text('Discard locally'),
                              onPressed: () async {
                                final confirmed = await showDialog<bool>(
                                  context: dialog,
                                  builder: (confirm) => AlertDialog(
                                    title: const Text(
                                      'Discard saved action locally?',
                                    ),
                                    content: const Text(
                                      'This does not change server history. '
                                      'Any new action requires re-entry and a new operation ID.',
                                    ),
                                    actions: [
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.pop(confirm, false),
                                        child: const Text('Cancel'),
                                      ),
                                      TextButton(
                                        onPressed: () =>
                                            Navigator.pop(confirm, true),
                                        child: const Text('Discard locally'),
                                      ),
                                    ],
                                  ),
                                );
                                if (confirmed != true) return;
                                await OnlineIntentService.discardForReconciliation(
                                  item['id'],
                                );
                                if (dialog.mounted) Navigator.pop(dialog);
                              },
                            ),
                    ),
                  if (items.isEmpty)
                    const Text(
                      'No saved AI or Community create actions for this owner. '
                      'Progress, flashcard and other online evidence remains preserved in storage.',
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialog),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Saved actions need storage or session recovery.'),
          ),
        );
      }
    }
  }
}
