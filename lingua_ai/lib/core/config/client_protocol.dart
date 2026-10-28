import 'dart:async';

class ClientProtocol {
  static const revision = 2;
  static const header = 'X-Client-Protocol';
  static const developmentBuildId = 'development';
  static const buildId =
      String.fromEnvironment('BUILD_ID', defaultValue: developmentBuildId);
  static bool validBuildId(String value) =>
      RegExp(r'^[A-Za-z0-9._-]{1,96}$').hasMatch(value);
  static String? get requestRevision {
    final recorded = Zone.current[#recordedClientProtocol];
    return recorded is _RecordedProtocol
        ? recorded.revision?.toString()
        : revision.toString();
  }

  static Future<T> withRecordedRevision<T>(
          int? revision, Future<T> Function() work) =>
      runZoned(work,
          zoneValues: {#recordedClientProtocol: _RecordedProtocol(revision)});
}

class _RecordedProtocol {
  final int? revision;
  const _RecordedProtocol(this.revision);
}
