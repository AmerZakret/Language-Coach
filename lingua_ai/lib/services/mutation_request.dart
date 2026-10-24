import 'dart:async';
import 'dart:math';
import 'backend_http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'auth_service.dart';
import 'api_response.dart';
import 'sync_retry_policy.dart';

String newMutationId() {
  final random = Random.secure();
  return List.generate(
      16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

class MutationIntents {
  final Map<String, ({String payload, String id})> _pending = {};
  String operation(String slot, String payload, {String? operationId}) {
    if (operationId != null) return operationId;
    final previous = _pending[slot];
    if (previous?.payload == payload) return previous!.id;
    final id = newMutationId();
    _pending[slot] = (payload: payload, id: id);
    return id;
  }

  String? pendingId(String slot) => _pending[slot]?.id;
  void complete(String slot, String id) {
    if (_pending[slot]?.id == id) _pending.remove(slot);
  }
}

final _mutationTails = <String, Future<void>>{};
Future<http.Response> mutationRequest(
    Future<http.Response> Function() send, SessionSnapshot session,
    {String? serialKey}) async {
  Future<http.Response> dispatch() {
    if (!session.isCurrent) throw StateError('Mutation session changed');
    return apiRequest(() => send().timeout(replayTimeout), session);
  }

  Future<http.Response> attempt() async {
    try {
      return await dispatch();
    } on ApiException catch (error) {
      if (!session.isCurrent ||
          (error.kind != ApiFailure.network &&
              error.kind != ApiFailure.server)) {
        rethrow;
      }
      return dispatch();
    }
  }

  if (serialKey == null) return attempt();
  final previous = _mutationTails[serialKey] ?? Future<void>.value();
  final released = Completer<void>();
  _mutationTails[serialKey] = released.future;
  await previous;
  try {
    return await attempt();
  } finally {
    released.complete();
    if (identical(_mutationTails[serialKey], released.future)) {
      _mutationTails.remove(serialKey);
    }
  }
}

// MultipartRequest is single-use. Capture bytes once, then rebuild the request
// for each transport retry, preserving its key, fields and image content.
class PreparedMultipartMutation {
  final http.MultipartRequest request;
  final List<
      ({
        String field,
        String? filename,
        MediaType contentType,
        List<int> bytes
      })> files;
  PreparedMultipartMutation._(this.request, this.files);
  static Future<PreparedMultipartMutation> prepare(
      http.MultipartRequest request) async {
    final files = <({
      String field,
      String? filename,
      MediaType contentType,
      List<int> bytes
    })>[];
    for (final file in request.files) {
      files.add((
        field: file.field,
        filename: file.filename,
        contentType: file.contentType,
        bytes: await file.finalize().toBytes()
      ));
    }
    return PreparedMultipartMutation._(request, files);
  }

  Future<http.Response> send(SessionSnapshot session) =>
      mutationRequest(() async {
        final next = http.MultipartRequest(request.method, request.url)
          ..headers.addAll(request.headers)
          ..fields.addAll(request.fields);
        for (final file in files) {
          next.files.add(http.MultipartFile.fromBytes(file.field, file.bytes,
              filename: file.filename, contentType: file.contentType));
        }
        return http.sendMultipart(next);
      }, session);
}
