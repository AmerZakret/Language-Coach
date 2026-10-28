import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../core/config/api_config.dart';
import '../core/config/client_protocol.dart';
import 'backend_http.dart' as backend;
import 'client_compatibility.dart';
import 'sync_storage.dart';

enum TimelineState { unknown, current, changed, unavailable }

enum TimelineDiscovery { same, changed, firstConfirmed }

enum TimelineProvenance { verified, legacyUnverified }

enum TimelineFailure { reconciliation, provenance, maintenance }

class TimelineRecoveryRequired implements Exception {
  final TimelineFailure kind;
  final int? statusCode;
  final String? code;
  final int? retryAfterMs;
  const TimelineRecoveryRequired({this.kind = TimelineFailure.reconciliation,
    this.statusCode, this.code, this.retryAfterMs});
  @override
  String toString() =>
      'Server history needs reconciliation. Saved work is '
      'preserved; reconnect and refresh before creating a new action.';
}

// Equality token only. Local file generations, builds and progress epochs have
// independent meanings and are never used as a substitute for this value.
class DataTimeline extends ChangeNotifier {
  static final DataTimeline _instance = DataTimeline._();
  factory DataTimeline() => _instance;
  DataTimeline._();
  static const storageOwner = 'timeline_global';
  static const header = 'X-Data-Timeline';
  static bool valid(dynamic value) =>
      value is String &&
      value.length == 36 &&
      RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      ).hasMatch(value);
  TimelineState _state = TimelineState.unknown;
  TimelineState get state => _state;
  String? _lastConfirmed;
  String? get lastConfirmedDataTimelineId => _lastConfirmed;
  bool _fresh = false;
  bool _writesOpen = false;
  bool get freshlyConfirmed => _fresh;
  bool _loaded = false;
  Future<void>? _loading;
  Future<TimelineDiscovery>? _discovering;
  int _revision = 0;
  int get revision => _revision;
  bool _recoveryRequired = false;
  bool get recoveryRequired => _recoveryRequired;
  bool _hasEvidence = false;
  bool get hasEvidence => _hasEvidence;

  Future<void> load() {
    if (_loaded) return Future.value();
    return _loading ??= _load().whenComplete(() => _loading = null);
  }

  Future<void> _load() async {
    final record = await SyncStorage.backend.read(storageOwner);
    if (record != null) {
      if (record['schemaVersion'] != 1 ||
          record['ownerNamespace'] != storageOwner ||
          !valid(record['lastConfirmedDataTimelineId']) ||
          record['recoveryRequired'] is! bool) {
        throw SyncStorageCorruption();
      }
      _lastConfirmed = record['lastConfirmedDataTimelineId'];
      _recoveryRequired = record['recoveryRequired'];
    }
    _loaded = true; // A cached value is deliberately not fresh authority.
  }

  void unavailable() {
    _fresh = false;
    _writesOpen = false;
    if (_state == TimelineState.unavailable) return;
    _state = TimelineState.unavailable;
    notifyListeners();
  }

  Future<TimelineDiscovery> discover({
    Future<backend.Response> Function()? fetch,
  }) =>
      _discovering ??= _discover(fetch).whenComplete(() => _discovering = null);
  Future<TimelineDiscovery> _discover(
    Future<backend.Response> Function()? fetch,
  ) async {
    _fresh = false;
    await load();
    try {
      final response =
          await (fetch?.call() ??
                  backend.get(
                    Uri.parse('${ApiConfig.baseUrl}/compatibility'),
                    headers: {'Cache-Control': 'no-cache'},
                  ))
              .timeout(const Duration(seconds: 5));
      if (response.statusCode != 200) throw const TimelineRecoveryRequired();
      final value = jsonDecode(response.body);
      if (value is! Map ||
          !valid(value['dataTimelineId']) ||
          value['timelineAwareProtocolRevision'] != ClientProtocol.revision ||
          value['currentProtocolRevision'] is! int ||
          value['currentProtocolRevision'] < ClientProtocol.revision ||
          value['minimumMutationRevision'] is! int ||
          value['minimumMutationRevision'] > ClientProtocol.revision ||
          !['OPEN', 'CLOSED'].contains(value['timelineWriteState'])) {
        throw const TimelineRecoveryRequired();
      }
      final next = value['dataTimelineId'] as String;
      final result = _lastConfirmed == null
          ? TimelineDiscovery.firstConfirmed
          : _lastConfirmed == next
          ? TimelineDiscovery.same
          : TimelineDiscovery.changed;
      final changed = result == TimelineDiscovery.changed;
      // Commit authority before publishing it or enabling any drain.
      await SyncStorage.backend.write(storageOwner, {
        'schemaVersion': 1,
        'ownerNamespace': storageOwner,
        'lastConfirmedDataTimelineId': next,
        'recoveryRequired': recoveryRequired || changed,
      });
      if (_lastConfirmed != next) ++_revision;
      _lastConfirmed = next;
      _fresh = true;
      _writesOpen = value['timelineWriteState'] == 'OPEN';
      _recoveryRequired = recoveryRequired || changed;
      _state = recoveryRequired
          ? TimelineState.changed
          : _writesOpen
          ? TimelineState.current
          : TimelineState.unavailable;
      notifyListeners(); // Consumers invalidate reads before drains resume.
      return result;
    } catch (_) {
      unavailable();
      rethrow;
    }
  }

  Future<void> ensureFresh() async {
    await load();
    if (!_fresh) await discover();
    if (!_fresh) throw const TimelineRecoveryRequired();
  }

  String captureNewWork() {
    ClientCompatibility().ensureMutationAllowed();
    if (!valid(_lastConfirmed)) throw const TimelineRecoveryRequired();
    return _lastConfirmed!; // Known-offline capture is allowed, never dispatch.
  }

  bool canDispatch(String? stored) =>
      _fresh && _writesOpen && valid(stored) && stored == _lastConfirmed;
  void requireStored(String? stored) {
    if (!canDispatch(stored)) {
      noteEvidence();
      throw const TimelineRecoveryRequired();
    }
  }

  void noteEvidence() {
    if (hasEvidence) return;
    _hasEvidence = true;
    notifyListeners();
  }

  String cacheKey(String key) =>
      '${key}_timeline_${_lastConfirmed ?? 'unverified'}';
  bool matchesCache(dynamic stored) =>
      valid(stored) && stored == _lastConfirmed;
  static String? get recorded => Zone.current[#storedDataTimeline] as String?;
  // Only wrap a previously persisted record. No method can change its timeline.
  static Future<T> replay<T>(String? stored, Future<T> Function() work) {
    DataTimeline().requireStored(stored);
    return runZoned(work, zoneValues: {#storedDataTimeline: stored});
  }

  @visibleForTesting
  void resetForTesting({String? confirmed, bool fresh = true}) {
    _lastConfirmed = confirmed;
    _fresh = confirmed != null && fresh;
    _writesOpen = _fresh;
    _loaded = confirmed != null;
    _loading = null;
    _discovering = null;
    _state = _fresh ? TimelineState.current : TimelineState.unknown;
    _recoveryRequired = false;
    _hasEvidence = false;
    ++_revision;
  }
}
