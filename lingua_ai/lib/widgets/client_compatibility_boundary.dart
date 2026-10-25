import 'package:flutter/material.dart';
import '../services/client_compatibility.dart';

class ClientCompatibilityBoundary extends StatelessWidget {
  final Widget child;
  const ClientCompatibilityBoundary({super.key, required this.child});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: ClientCompatibility(),
        builder: (context, _) => Column(children: [
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
                            textDirection: TextDirection.ltr)))),
          Expanded(child: child),
        ]),
      );
}
