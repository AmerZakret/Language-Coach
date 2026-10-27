// The only application HTTP boundary for backend service calls. Selected
// external/blob image and audio fetches are deliberately outside this contract.
import 'dart:convert';
import 'package:http/http.dart' as transport;
import '../core/config/api_config.dart';
import '../core/config/client_protocol.dart';
import 'client_compatibility.dart';
import 'api_response.dart';
import 'data_timeline.dart';
import 'direct_mutation_evidence.dart';
export 'package:http/http.dart'
    show
        Response,
        Client,
        ClientException,
        MultipartRequest,
        MultipartFile,
        StreamedResponse,
        Request,
        runWithClient;

bool _backend(Uri url) {
  final base = Uri.parse(ApiConfig.baseUrl);
  final path = base.path.replaceAll(RegExp(r'/+$'), '');
  return url.scheme == base.scheme &&
      url.host == base.host &&
      url.port == base.port &&
      (path.isEmpty || url.path == path || url.path.startsWith('$path/'));
}

bool protocolMutation(String method, Uri url) {
  final base = Uri.parse(ApiConfig.baseUrl).path.replaceAll(RegExp(r'/+$'), '');
  final path = url.path.substring(base.length).replaceAll(RegExp(r'/+$'), '');
  return !['GET', 'HEAD', 'OPTIONS'].contains(method.toUpperCase()) &&
      (RegExp(r'^/(progress|flashcards|community/posts)(/|$)').hasMatch(path) ||
          RegExp(r'^/ai-coach/(chat|clear)$').hasMatch(path));
}

bool durableMutation(String method, Uri url) =>
    protocolMutation(method, url) ||
    (!['GET', 'HEAD', 'OPTIONS'].contains(method.toUpperCase()) &&
        (url.path.endsWith('/users/profile') ||
            url.path.endsWith('/auth/register') ||
            url.path.endsWith('/auth/guest')));

Future<transport.Response> _dispatch(
  Uri url,
  String method,
  Future<transport.Response> Function(Map<String, String>) send,
  Map<String, String>? headers, [
  Map<String, dynamic> evidence = const {},
  Future<Map<String, dynamic>> Function()? prepareEvidence,
]) async {
  final backend = _backend(url);
  final timeline = DataTimeline();
  final revision = timeline.revision;
  final durable = backend && durableMutation(method, url);
  final receipt = backend &&
      method == 'GET' &&
      RegExp(r'/progress/[^/]+/reset-receipts/[^/]+$').hasMatch(url.path);
  final storedTimeline = DataTimeline.recorded ??
      (receipt ? timeline.lastConfirmedDataTimelineId : null);
  if (receipt) await timeline.ensureFresh();
  if (backend && durable && ClientCompatibility().updateRequired) {
    throw const ApiException(
      ApiFailure.compatibility,
      'Client update or pending-work reconciliation is required. Saved work is preserved.',
      426,
      false,
      'CLIENT_PROTOCOL_UNSUPPORTED',
    );
  }
  if (durable && ClientProtocol.requestRevision != '2') {
    throw const TimelineRecoveryRequired();
  }
  if (durable && DataTimeline.recorded == null) {
    // Online-only callers cannot bypass provenance. Capture the cached lineage
    // before discovery; ambiguous retries find the original record by key.
    return DirectMutationEvidence.send(
      method: method,
      path: url.path,
      operationId: headers?.entries
          .where((e) => e.key.toLowerCase() == 'x-idempotency-key')
          .firstOrNull
          ?.value,
      payload: url.path.contains('/auth/')
          ? const {'credentialsRetained': false}
          : {
              'query': url.query,
              if (headers != null)
                'resourceRevision': headers.entries
                    .where((e) => e.key.toLowerCase() == 'x-resource-revision')
                    .firstOrNull
                    ?.value,
              ...evidence,
            },
      preparePayload: prepareEvidence,
      dispatch: () => _dispatch(url, method, send, headers, evidence),
      acknowledged: (response) =>
          response.statusCode >= 200 && response.statusCode < 300,
    );
  }
  final merged = {...?headers};
  merged.removeWhere(
    (key, _) =>
        key.toLowerCase() == DataTimeline.header.toLowerCase() ||
        (!backend && key.toLowerCase() == ClientProtocol.header.toLowerCase()),
  );
  if (backend) {
    merged.removeWhere(
      (key, _) => key.toLowerCase() == ClientProtocol.header.toLowerCase(),
    );
    final revision = ClientProtocol.requestRevision;
    if (revision != null) merged[ClientProtocol.header] = revision;
    if (durable || receipt) {
      timeline.requireStored(storedTimeline);
      merged[DataTimeline.header] = storedTimeline!;
    }
  }
  final response = await send(merged);
  if (backend &&
      !url.path.endsWith('/compatibility') &&
      !url.path.contains('/health') &&
      revision != timeline.revision) {
    throw const TimelineRecoveryRequired();
  }
  if (durable || receipt) timeline.requireStored(storedTimeline);
  if (backend && response.statusCode >= 400) {
    try {
      final value = jsonDecode(response.body);
      if (value is Map &&
          [
            'TIMELINE_MISMATCH',
            'TIMELINE_CONTROL_UNAVAILABLE',
            'WRITES_CLOSED',
            'FENCE_CONFLICT',
            'DATA_TIMELINE_REQUIRED',
            'SERVER_TIMELINE_REQUIRED',
            'SERVER_TIMELINE_CHANGED',
            'RECEIPT_TIMELINE_UNVERIFIED',
            'BACKEND_NOT_READY',
          ].contains(value['code'])) {
        timeline.unavailable();
        final code = value['code'] as String;
        final kind = response.statusCode == 503 || ['WRITES_CLOSED', 'BACKEND_NOT_READY', 'TIMELINE_CONTROL_UNAVAILABLE'].contains(code)
            ? TimelineFailure.maintenance
            : response.statusCode == 428 || ['SERVER_TIMELINE_REQUIRED', 'DATA_TIMELINE_REQUIRED', 'RECEIPT_TIMELINE_UNVERIFIED'].contains(code)
                ? TimelineFailure.provenance : TimelineFailure.reconciliation;
        final seconds = int.tryParse(response.headers['retry-after'] ?? '');
        throw TimelineRecoveryRequired(kind: kind, statusCode: response.statusCode, code: code,
            retryAfterMs: kind == TimelineFailure.maintenance && seconds != null ? seconds.clamp(0, 300) * 1000 : null);
      }
    } on FormatException {
      /* Ordinary errors keep their existing handling. */
    }
  }
  if (backend && response.statusCode == 426) {
    String? code;
    try {
      final value = jsonDecode(response.body);
      final raw = value is Map ? value['code'] : null;
      if (raw is String) code = raw;
    } on FormatException {
      /* Unknown errors remain ordinary HTTP errors. */
    }
    if (ClientCompatibility.isCompatibilityCode(code)) {
      ClientCompatibility().requireUpdate();
      throw ApiException(
        ApiFailure.compatibility,
        'Client update or pending-work reconciliation is required. Saved work is preserved.',
        426,
        false,
        code,
      );
    }
  }
  return response;
}

Future<transport.Response> get(Uri url, {Map<String, String>? headers}) =>
    _dispatch(
      url,
      'GET',
      (merged) => transport.get(url, headers: merged),
      headers,
    );
Future<transport.Response> post(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) =>
    _dispatch(
      url,
      'POST',
      (merged) =>
          transport.post(url, headers: merged, body: body, encoding: encoding),
      headers,
      {'body': body},
    );
Future<transport.Response> put(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) =>
    _dispatch(
      url,
      'PUT',
      (merged) =>
          transport.put(url, headers: merged, body: body, encoding: encoding),
      headers,
      {'body': body},
    );
Future<transport.Response> patch(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) =>
    _dispatch(
      url,
      'PATCH',
      (merged) =>
          transport.patch(url, headers: merged, body: body, encoding: encoding),
      headers,
      {'body': body},
    );
Future<transport.Response> delete(
  Uri url, {
  Map<String, String>? headers,
  Object? body,
  Encoding? encoding,
}) =>
    _dispatch(
      url,
      'DELETE',
      (merged) => transport.delete(url,
          headers: merged, body: body, encoding: encoding),
      headers,
      {'body': body},
    );
Future<transport.Response> sendMultipart(transport.MultipartRequest request) =>
    _dispatch(
      request.url,
      request.method,
      (merged) async {
        request.headers
          ..clear()
          ..addAll(merged);
        return transport.Response.fromStream(await request.send());
      },
      request.headers,
      {'fields': Map<String, String>.from(request.fields)},
      () async {
        // Single-use file streams are frozen and rebuilt before the journal
        // commits. A lost upload response retains the exact bytes and revision.
        final files = <Map<String, dynamic>>[];
        final rebuilt = <transport.MultipartFile>[];
        for (final file in request.files) {
          final bytes = await file.finalize().toBytes();
          files.add({
            'field': file.field,
            'filename': file.filename,
            'contentType': file.contentType.toString(),
            'bytes': base64Encode(bytes),
          });
          rebuilt.add(
            transport.MultipartFile.fromBytes(
              file.field,
              bytes,
              filename: file.filename,
              contentType: file.contentType,
            ),
          );
        }
        request.files
          ..clear()
          ..addAll(rebuilt);
        return {'files': files};
      },
    );

Future<transport.Response> sendWithClient(
  transport.Client client,
  transport.Request request,
) =>
    _dispatch(
      request.url,
      request.method,
      (merged) async {
        request.headers
          ..clear()
          ..addAll(merged);
        return transport.Response.fromStream(await client.send(request));
      },
      request.headers,
      {'body': request.body},
    );

// Selected device/blob/media bytes are outside the backend protocol contract,
// including URLs that happen to share the configured backend origin.
Future<transport.Response> getMedia(Uri url) => transport.get(url);
