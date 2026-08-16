/// Typed error hierarchy for every network call the mobile client makes.
///
/// Mirrors the web app's `AuthError`/`apiFetch` contract (`frontend/lib/auth/
/// apiClient.ts`): callers branch on a typed exception, never on a raw
/// `SocketException`, `TimeoutException` or `Map<String, dynamic>`.
abstract class ApiException implements Exception {
  const ApiException({
    required this.status,
    required this.code,
    required this.message,
  });

  /// HTTP status, or 0 when there was no response at all.
  final int status;

  /// Machine-readable code — the backend envelope's `error.code` when present.
  final String code;

  /// Human-readable message for the UI.
  final String message;

  @override
  String toString() => '$runtimeType($status $code): $message';
}

/// A 4xx/5xx response that is not a 401. Carries the parsed
/// `{ error: { code, message } }` envelope when the backend sent one.
class ApiError extends ApiException {
  const ApiError({
    required super.status,
    required super.code,
    required super.message,
  });
}

/// No response arrived — offline, DNS failure or timeout. Surfaces so the
/// offline-first flows (capture, queue) can branch on it instead of crashing.
class NetworkError extends ApiException {
  NetworkError(String message)
      : super(status: 0, code: 'network_error', message: message);
}

/// A 401 specifically. Carries the "session is gone" signal: the client
/// translates it into a sign-out + redirect to /login (see `HttpClient`).
class UnauthorizedError extends ApiException {
  UnauthorizedError(String message)
      : super(status: 401, code: 'unauthorized', message: message);
}
