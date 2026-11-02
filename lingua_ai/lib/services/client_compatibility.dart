import 'package:flutter/foundation.dart';

class ClientCompatibility extends ChangeNotifier {
  static final ClientCompatibility _instance = ClientCompatibility._();
  factory ClientCompatibility() => _instance;
  ClientCompatibility._();
  bool _updateRequired = false;
  bool get updateRequired => _updateRequired;
  static bool isCompatibilityCode(String? code) =>
      code == 'CLIENT_PROTOCOL_REQUIRED' ||
      code == 'CLIENT_PROTOCOL_UNSUPPORTED';
  void ensureMutationAllowed() {
    if (_updateRequired) throw const ClientCompatibilityException();
  }

  void requireUpdate() {
    if (_updateRequired) return;
    _updateRequired = true;
    notifyListeners();
  }

  @visibleForTesting
  void resetForTesting() {
    _updateRequired = false;
  }
}

class ClientCompatibilityException implements Exception {
  const ClientCompatibilityException();
  @override
  String toString() =>
      'Client update or pending-work reconciliation is required. Saved work is preserved.';
}
