import 'errors.dart';
import 'http_client.dart';

/// Authenticated user shape returned by `GET /api/me` (mirrors
/// `AuthUser` in `frontend/lib/auth/apiClient.ts`). `roles`/`primaryRole`
/// stay optional on the wire so an older BE partial mock still parses.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    this.roles = const <String>[],
    this.primaryRole,
    this.jobTitle,
    this.department,
  });

  final String id;
  final String email;
  final String name;
  final String role;
  final List<String> roles;
  final String? primaryRole;
  final String? jobTitle;
  final String? department;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    Object? stringList(Object? v) => v is List ? v.map((e) => '$e').toList() : null;
    return AuthUser(
      id: '${json['id'] ?? ''}',
      email: '${json['email'] ?? ''}',
      name: '${json['name'] ?? ''}',
      role: '${json['role'] ?? json['primaryRole'] ?? 'employee'}',
      roles: (stringList(json['roles']) as List<String>?) ?? const <String>[],
      primaryRole: json['primaryRole'] == null ? null : '${json['primaryRole']}',
      jobTitle: json['jobTitle'] == null ? null : '${json['jobTitle']}',
      department: json['department'] == null ? null : '${json['department']}',
    );
  }
}

/// POST credentials to the Better Auth email+password endpoint. Resolves to
/// the authenticated user and lets the cookie store keep the session cookie.
///
/// HTTP contract (matches Better Auth's `signIn.email`, verified against the
/// backend in #89): `POST /api/auth/sign-in/email` with the JSON body
/// `{ "email": ..., "password": ... }`. The response `Set-Cookie`s an
/// httpOnly session cookie that [httpClient]'s shared [HttpClient] cookie jar
/// stores and re-sends on every later request.
///
/// Better Auth's raw sign-in answer is not the normalized shape — `/api/me`
/// is — so the session is read back after the POST, same as the web client.
Future<AuthUser> signIn(String email, String password) async {
  await httpClient.request(
    method: 'POST',
    path: '/api/auth/sign-in/email',
    body: <String, String>{'email': email, 'password': password},
  );
  final user = await getCurrentUser();
  if (user == null) {
    throw const ApiError(
      status: 500,
      code: 'no_user',
      message: 'Sign-in response did not include a user.',
    );
  }
  return user;
}

/// Invalidate the server-side session. Always resolves (even on network/BE
/// errors) so the caller can clear local state unconditionally — a stranded
/// cookie is harmless once the app has dropped its session.
Future<void> signOut() async {
  try {
    await httpClient.request(method: 'POST', path: '/api/auth/sign-out');
  } on ApiException {
    // BE unreachable or already signed out — local state is cleared upstream.
  }
}

/// Read the current authenticated user from `GET /api/me`. Returns null on
/// 401 (no/invalid session — not exceptional); throws [ApiError] on other
/// non-2xx and [NetworkError] when offline.
Future<AuthUser?> getCurrentUser() async {
  final dynamic data;
  try {
    data = await httpClient.request(method: 'GET', path: '/api/me');
  } on UnauthorizedError {
    return null;
  }
  if (data is Map<String, dynamic> && data['user'] is Map<String, dynamic>) {
    return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
  }
  return null;
}
