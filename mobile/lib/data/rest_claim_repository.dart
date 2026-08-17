import '../api/auth.dart';
import '../api/errors.dart';
import '../api/http_client.dart';
import '../models/models.dart';
import 'claim_repository.dart';

/// Live [ClaimRepository] over the #90 [HttpClient] seam.
///
/// Stub status per #91: the endpoint shapes follow the #89 BE contract, but
/// nothing here is exercised against a real backend yet — the app still boots
/// with [FixturesClaimRepository]. JSON decoding is deliberately tolerant
/// (`claims`/bare list, missing optional fields) so the exact wire format can
/// be tightened in #91b/#91c without redesign.
class RestClaimRepository implements ClaimRepository {
  RestClaimRepository({HttpClient? client}) : _client = client ?? httpClient;

  final HttpClient _client;

  @override
  Future<AuthUser?> getCurrentUser() async {
    final dynamic data;
    try {
      data = await _client.request(method: 'GET', path: '/api/me');
    } on UnauthorizedError {
      return null;
    }
    if (data is Map<String, dynamic> && data['user'] is Map<String, dynamic>) {
      return AuthUser.fromJson(data['user'] as Map<String, dynamic>);
    }
    return null;
  }

  @override
  Future<AuthUser> signIn(String email, String password) async {
    await _client.request(
      method: 'POST',
      path: '/api/auth/sign-in/email',
      body: <String, String>{'email': email, 'password': password},
    );
    // Better Auth's raw answer is not the normalized shape — `/api/me` is —
    // so the session is read back after the POST (web client parity).
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

  @override
  Future<void> signOut() async {
    try {
      await _client.request(method: 'POST', path: '/api/auth/sign-out');
    } on ApiException {
      // BE unreachable or already signed out — local state is cleared upstream.
    }
  }

  @override
  Future<List<Claim>> listClaims(String employeeId) async {
    final data = await _client.request(
      method: 'GET',
      path: '/api/claims',
      query: <String, String>{'employee_id': employeeId},
    );
    return _claimsFrom(data);
  }

  @override
  Future<Claim?> claimById(String claimId) async {
    final dynamic data;
    try {
      data = await _client.request(method: 'GET', path: '/api/claims/$claimId');
    } on ApiError catch (error) {
      if (error.status == 404) return null;
      rethrow;
    }
    if (data is Map<String, dynamic> && data['claim'] is Map<String, dynamic>) {
      return _claimFrom(data['claim'] as Map<String, dynamic>);
    }
    return data is Map<String, dynamic> ? _claimFrom(data) : null;
  }

  @override
  Future<List<InboxItem>> listInbox(String approverId) async {
    final data =
        await _client.request(method: 'GET', path: '/api/inbox/$approverId');
    final rows = data is Map<String, dynamic> ? data['inbox'] : data;
    if (rows is! List) return const <InboxItem>[];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(_inboxItemFrom)
        .toList();
  }

  /* ---------------- decoding ---------------- */

  List<Claim> _claimsFrom(dynamic data) {
    final rows = data is Map<String, dynamic> ? data['claims'] : data;
    if (rows is! List) return const <Claim>[];
    return rows.whereType<Map<String, dynamic>>().map(_claimFrom).toList();
  }

  Claim _claimFrom(Map<String, dynamic> json) {
    final lines = _linesFrom(json['lines']);
    return Claim(
      id: '${json['id'] ?? ''}',
      code: '${json['code'] ?? ''}',
      title: '${json['title'] ?? ''}',
      place: '${json['place'] ?? ''}',
      status: _enumByName(ClaimStatus.values, json['status'],
          fallback: ClaimStatus.pending),
      amount: (json['amount'] as num?)?.toInt() ?? 0,
      dateLabel: '${json['dateLabel'] ?? json['date_label'] ?? ''}',
      itemCount: (json['itemCount'] as num?)?.toInt() ?? lines.length,
      receiptCount:
          (json['receiptCount'] as num?)?.toInt() ?? lines.where((l) => l.file != null).length,
      headline: '${json['headline'] ?? ''}',
      slaLabel: json['slaLabel'] == null ? null : '${json['slaLabel']}',
      lines: lines,
      timeline: _timelineFrom(json['timeline']),
    );
  }

  List<ClaimLine> _linesFrom(dynamic rows) {
    if (rows is! List) return const <ClaimLine>[];
    return rows.whereType<Map<String, dynamic>>().map((json) {
      return ClaimLine(
        code: '${json['code'] ?? ''}',
        description: '${json['description'] ?? ''}',
        meta: '${json['meta'] ?? ''}',
        amount: (json['amount'] as num?)?.toInt() ?? 0,
        source: _enumByName(LineSource.values, json['source'],
            fallback: LineSource.manual),
        file: json['file'] == null ? null : '${json['file']}',
        flagText: json['flagText'] == null ? null : '${json['flagText']}',
      );
    }).toList();
  }

  List<TimelineEntry> _timelineFrom(dynamic rows) {
    if (rows is! List) return const <TimelineEntry>[];
    return rows.whereType<Map<String, dynamic>>().map((json) {
      return TimelineEntry(
        title: '${json['title'] ?? ''}',
        actor: '${json['actor'] ?? ''}',
        time: '${json['time'] ?? ''}',
        tone: _enumByName(TimelineTone.values, json['tone'],
            fallback: TimelineTone.pending),
        body: json['body'] == null ? null : '${json['body']}',
      );
    }).toList();
  }

  InboxItem _inboxItemFrom(Map<String, dynamic> json) {
    final submitter = '${json['submitter'] ?? json['name'] ?? ''}';
    return InboxItem(
      id: '${json['id'] ?? ''}',
      submitter: submitter,
      initials:
          '${json['initials'] ?? submitter.split(' ').map((p) => p.isEmpty ? '' : p[0]).take(2).join()}',
      title: '${json['title'] ?? ''}',
      sub: '${json['sub'] ?? ''}',
      amount: (json['amount'] as num?)?.toInt() ?? 0,
      sla: '${json['sla'] ?? ''}',
      slaTone: _enumByName(SlaTone.values, json['slaTone'],
          fallback: SlaTone.info),
      flagText: json['flagText'] == null ? null : '${json['flagText']}',
    );
  }

  T _enumByName<T extends Enum>(List<T> values, Object? raw,
      {required T fallback}) {
    if (raw is! String) return fallback;
    for (final value in values) {
      if (value.name == raw) return value;
    }
    return fallback;
  }
}
