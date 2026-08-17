import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'errors.dart';

/// Backend origin, mirroring the web app's `NEXT_PUBLIC_BE_URL`.
///
/// Override at build/run time with:
///   flutter run --dart-define=SPENDFLOW_BE_URL=https://api.example.com
const String kBackendUrl = String.fromEnvironment(
  'SPENDFLOW_BE_URL',
  defaultValue: 'http://localhost:8787',
);

/// The one HTTP seam every screen talks through (no raw network calls
/// elsewhere in `lib/`).
///
/// Auth is cookie-based: Better Auth issues an httpOnly session cookie, so the
/// client sends/stores cookies via the underlying [http.Client] (dart:io keeps
/// a per-instance cookie store) rather than a bearer token. The session lives
/// as long as the client instance — i.e. one app run.
class HttpClient {
  HttpClient({Uri? baseUrl, http.Client? inner})
      : baseUrl = baseUrl ?? Uri.parse(kBackendUrl),
        _inner = inner ?? http.Client();

  /// Backend origin every relative `path` is resolved against.
  final Uri baseUrl;
  final http.Client _inner;

  /// Registered once by the app shell: fires on any 401 so the UI can sign
  /// out and route to /login in one place (web parity with
  /// `registerUnauthorizedHandler` in `frontend/lib/api/fetch.ts`).
  void Function()? onUnauthorized;

  /// Register (or clear, with null) the global 401 callback.
  void setAuth401Handler(void Function()? callback) {
    onUnauthorized = callback;
  }

  /// Sends a request and returns the decoded body.
  ///
  /// - [method] HTTP verb, e.g. `'GET'` / `'POST'`.
  /// - [path] API path starting with `/`, e.g. `'/api/me'`.
  /// - [body] JSON-encodable request body (implies `application/json`).
  /// - [query] query params; encoded, empty values kept.
  /// - [timeout] 10s by default; uploads pass 30s.
  ///
  /// Throws [UnauthorizedError] on 401 (and fires [onUnauthorized]),
  /// [ApiError] on any other 4xx/5xx, [NetworkError] when no response
  /// arrives (offline, DNS failure, timeout).
  Future<dynamic> request({
    required String method,
    required String path,
    Object? body,
    Map<String, String>? query,
    Duration timeout = const Duration(seconds: 10),
  }) async {
    var uri = Uri.parse('$baseUrl$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: query);
    }

    final headers = <String, String>{};
    String? encoded;
    if (body != null) {
      headers['content-type'] = 'application/json';
      encoded = _jsonEncode(body);
    }

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (encoded != null) request.body = encoded;
    return _send(request, timeout);
  }

  /// Sends the captured frame as a multipart/form-data upload.
  ///
  /// The [HttpClient] is JSON-only everywhere else, so this is the one place a
  /// binary body is allowed. The auth cookie is still attached via the shared
  /// [http.Client]; only the content-type switches to multipart.
  ///
  /// Error behaviour matches [request]: [UnauthorizedError] on 401 (firing
  /// [onUnauthorized]), [ApiError] on any other 4xx/5xx, [NetworkError] when
  /// no response arrives.
  Future<dynamic> upload({
    required String path,
    required Map<String, String> fields,
    required Uint8List bytes,
    required String filename,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final request = http.MultipartRequest('POST', uri)
      ..fields.addAll(fields)
      ..files.add(http.MultipartFile.fromBytes('file', bytes,
          filename: filename));
    return _send(request, timeout);
  }

  /// Shared send + status handling for [request] and [upload].
  Future<dynamic> _send(http.BaseRequest request, Duration timeout) async {
    final http.Response response;
    try {
      final streamed = await _inner.send(request).timeout(timeout);
      response = await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw NetworkError('Request timed out after ${timeout.inSeconds}s.');
    } catch (error) {
      // SocketException, ClientException, DNS failures — anything that means
      // "no response" rather than "bad response".
      throw NetworkError('Network request failed: $error');
    }

    if (response.statusCode == 401) {
      final message = _readErrorMessage(response);
      if (onUnauthorized != null) onUnauthorized!();
      throw UnauthorizedError(message);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiError(
        status: response.statusCode,
        code: _readErrorCode(response),
        message: _readErrorMessage(response),
      );
    }

    return _decodeBody(response);
  }

  /// JSON-encodes [body]; kept as a seam so tests can target it in isolation.
  String _jsonEncode(Object? body) => jsonEncode(body);

  static dynamic _decodeBody(http.Response response) {
    final contentType = response.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().contains('application/json')) {
      return response.body;
    }
    if (response.body.isEmpty) return null;
    return jsonDecode(response.body);
  }

  /// Best-effort `{ error: { code, message } }` extraction, tolerating the
  /// same shapes the web client accepts (`{ message }`, plain string, …).
  static String _readErrorMessage(http.Response response) {
    try {
      final data = jsonDecode(response.body);
      if (data is Map<String, dynamic>) {
        final error = data['error'];
        if (error is Map<String, dynamic>) {
          final message = error['message'] ?? error['code'];
          if (message is String && message.trim().isNotEmpty) return message;
        }
        if (error is String && error.trim().isNotEmpty) return error;
        final message = data['message'];
        if (message is String && message.trim().isNotEmpty) return message;
      }
      if (data is String && data.trim().isNotEmpty) return data;
    } catch (_) {
      // Non-JSON body — fall through to the status fallback.
    }
    return 'Request failed (${response.statusCode}).';
  }

  static String _readErrorCode(http.Response response) {
    try {
      final data = jsonDecode(response.body);
      if (data is Map<String, dynamic>) {
        final error = data['error'];
        if (error is Map<String, dynamic>) {
          final code = error['code'];
          if (code is String && code.isNotEmpty) return code;
        }
      }
    } catch (_) {
      // Non-JSON body — generic code below.
    }
    return 'http_${response.statusCode}';
  }
}

/// The shared client instance. One dart:io cookie store for the whole app run.
final HttpClient httpClient = HttpClient();
