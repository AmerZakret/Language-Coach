// The only application HTTP boundary for backend service calls. Selected
// external/blob image and audio fetches are deliberately outside this contract.
import 'dart:convert';
import 'package:http/http.dart' as transport;
import '../core/config/api_config.dart';
import '../core/config/client_protocol.dart';
import 'client_compatibility.dart';
import 'api_response.dart';
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

Future<transport.Response> _dispatch(
    Uri url,
    String method,
    Future<transport.Response> Function(Map<String, String>) send,
    Map<String, String>? headers) async {
  final backend = _backend(url);
  if (backend &&
      protocolMutation(method, url) &&
      ClientCompatibility().updateRequired) {
    throw const ApiException(
        ApiFailure.compatibility,
        'Client update or pending-work reconciliation is required. Saved work is preserved.',
        426,
        false,
        'CLIENT_PROTOCOL_UNSUPPORTED');
  }
  final merged = {...?headers};
  if (backend) {
    merged.removeWhere(
        (key, _) => key.toLowerCase() == ClientProtocol.header.toLowerCase());
    final revision = ClientProtocol.requestRevision;
    if (revision != null) merged[ClientProtocol.header] = revision;
  }
  final response = await send(merged);
  if (backend && response.statusCode == 426) {
    String? code;
    try {
      final value = jsonDecode(response.body);
      final raw = value is Map ? value['code'] : null;
      if (raw is String) code = raw;
    } on FormatException {/* Unknown errors remain ordinary HTTP errors. */}
    if (ClientCompatibility.isCompatibilityCode(code)) {
      ClientCompatibility().requireUpdate();
      throw ApiException(
          ApiFailure.compatibility,
          'Client update or pending-work reconciliation is required. Saved work is preserved.',
          426,
          false,
          code);
    }
  }
  return response;
}

Future<transport.Response> get(Uri url, {Map<String, String>? headers}) =>
    _dispatch(
        url, 'GET', (merged) => transport.get(url, headers: merged), headers);
Future<transport.Response> post(Uri url,
        {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
    _dispatch(
        url,
        'POST',
        (merged) => transport.post(url,
            headers: merged, body: body, encoding: encoding),
        headers);
Future<transport.Response> put(Uri url,
        {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
    _dispatch(
        url,
        'PUT',
        (merged) =>
            transport.put(url, headers: merged, body: body, encoding: encoding),
        headers);
Future<transport.Response> patch(Uri url,
        {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
    _dispatch(
        url,
        'PATCH',
        (merged) => transport.patch(url,
            headers: merged, body: body, encoding: encoding),
        headers);
Future<transport.Response> delete(Uri url,
        {Map<String, String>? headers, Object? body, Encoding? encoding}) =>
    _dispatch(
        url,
        'DELETE',
        (merged) => transport.delete(url,
            headers: merged, body: body, encoding: encoding),
        headers);
Future<transport.Response> sendMultipart(transport.MultipartRequest request) =>
    _dispatch(request.url, request.method, (merged) async {
      request.headers
        ..clear()
        ..addAll(merged);
      return transport.Response.fromStream(await request.send());
    }, request.headers);

Future<transport.Response> sendWithClient(
        transport.Client client, transport.Request request) =>
    _dispatch(request.url, request.method, (merged) async {
      request.headers
        ..clear()
        ..addAll(merged);
      return transport.Response.fromStream(await client.send(request));
    }, request.headers);
