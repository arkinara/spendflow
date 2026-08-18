import 'package:flutter/foundation.dart';

import '../api/auth.dart';
import '../api/errors.dart';
import '../api/http_client.dart';
import '../models/models.dart';
import 'claim_repository.dart';
import 'mlkit_ocr_pass.dart';
import 'mock_ocr_pass.dart';
import 'ocr_pass.dart';

/// Live [ClaimRepository] over the #90 [HttpClient] seam.
///
/// Stub status per #91: the endpoint shapes follow the #89 BE contract, but
/// nothing here is exercised against a real backend yet — the app still boots
/// with [FixturesClaimRepository]. JSON decoding is deliberately tolerant
/// (`claims`/bare list, missing optional fields) so the exact wire format can
/// be tightened in #91b/#91c without redesign.
class RestClaimRepository implements ClaimRepository {
  RestClaimRepository({HttpClient? client, OcrPass? ocrPass})
      : _client = client ?? httpClient,
        _ocrPass = ocrPass;

  final HttpClient _client;

  /// The OCR pass used when [capture] is handed a real camera frame (#103).
  /// Injected by tests; lazily defaulted to the on-device [MlKitOcrPass]
  /// (mock fallback when the native library is unavailable).
  OcrPass? _ocrPass;

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

  /// Mock OCR pass (#93 lands the real one). 404/501 — the BE has no OCR
  /// endpoint yet — surface as [ApiError] straight from the [HttpClient]
  /// contract, exactly like any other 4xx/5xx.
  ///
  /// With a real camera frame (#103) the mock endpoint is skipped entirely:
  /// the bytes are uploaded to the BE's receipt storage first, then the
  /// on-device OCR pass reads the same frame. The upload is best-effort —
  /// a failure leaves the receipt URL off the [OcrResult] but never blocks
  /// the OCR draft (the URL is a nice-to-have, the OCR read is the source
  /// of truth).
  @override
  Future<OcrDraft> capture({Uint8List? cameraBytes}) async {
    if (cameraBytes == null) {
      final data =
          await _client.request(method: 'POST', path: '/api/mobile/capture');
      return _draftFrom(data);
    }
    final receiptUrl = await _uploadReceipt(cameraBytes);
    final result = await _ocrPassOrFallback().scanFrame(cameraBytes);
    final withUrl = result.copyWith(receiptUrl: receiptUrl);
    _lastOcrResult = withUrl;
    return withUrl.toOcrDraft();
  }

  /// The most recent OCR read that carried a real camera frame, including its
  /// [OcrResult.receiptUrl] when the upload landed. The draft handed to the
  /// confirm flow drops the URL (it is source metadata, not an editable
  /// field); this seam keeps it reachable for the receipt thumbnail later.
  OcrResult? _lastOcrResult;
  OcrResult? get lastOcrResult => _lastOcrResult;

  /// Push the captured frame to the BE's mobile receipt endpoint (#103).
  ///
  /// Returns the durable receiptUrl on success, null when the endpoint is
  /// missing (404), rejects the upload, or the network is down — the caller
  /// still runs the OCR pass and the capture flow continues.
  Future<String?> _uploadReceipt(Uint8List bytes) async {
    final dynamic data;
    try {
      data = await _client.upload(
        path: '/api/mobile/receipts',
        fields: const <String, String>{},
        bytes: bytes,
        filename: 'capture.jpg',
      );
    } on ApiException {
      // UnauthorizedError is an ApiException too — a session expiry mid-capture
      // also degrades to "no receipt URL" rather than killing the scan.
      return null;
    }
    if (data is Map<String, dynamic> && data['receiptUrl'] is String) {
      return data['receiptUrl'] as String;
    }
    return null;
  }

  OcrPass _ocrPassOrFallback() {
    final pass = _ocrPass;
    if (pass != null) return pass;
    try {
      return _ocrPass = MlKitOcrPass();
    } catch (error) {
      // A build without the ML Kit native library must not crash capture —
      // fall back to the fixtures mock and warn (same as AppState #99).
      debugPrint('SpendFlow: ML Kit OCR unavailable, using mock: $error');
      return _ocrPass = MockOcrPass();
    }
  }

  @override
  Future<OcrDraft> saveDraft(OcrDraft draft) async {
    final data = await _client.request(
      method: 'PATCH',
      path: '/api/mobile/drafts/current',
      body: _draftToJson(draft),
    );
    // A body-less 200 means "stored as sent" — echo the draft back rather
    // than decoding an empty response into blank fields.
    return data is Map<String, dynamic> ? _draftFrom(data) : draft;
  }

  /// Submit the confirmed draft as a claim (#92, reuses the #88 endpoint).
  /// Tolerates both `{ claim, status }` and a bare claim object.
  @override
  Future<SubmissionResult> submit(OcrDraft draft) async {
    final data = await _client.request(
      method: 'POST',
      path: '/api/mobile/claims',
      body: _draftToJson(draft),
    );
    final map = data is Map<String, dynamic> ? data : const <String, dynamic>{};
    final claimJson = map['claim'] is Map<String, dynamic>
        ? map['claim'] as Map<String, dynamic>
        : map;
    return SubmissionResult(
      claim: _claimFrom(claimJson),
      status: map['status'] is String ? map['status'] as String : 'submitted',
    );
  }

  /// Push the offline queue (#92). The BE endpoint is not landed yet — a
  /// 404/501 surfaces as [ApiError] like any other 4xx/5xx.
  @override
  Future<int> sync() async {
    final data =
        await _client.request(method: 'POST', path: '/api/mobile/sync');
    final map = data is Map<String, dynamic> ? data : const <String, dynamic>{};
    return (map['synced'] as num?)?.toInt() ?? 0;
  }

  /// Record the approver's verdict (#92). 200 → void; 4xx/5xx → [ApiError].
  @override
  Future<void> decide(String inboxItemId, Decision decision) async {
    await _client.request(
      method: 'POST',
      path: '/api/mobile/inbox/$inboxItemId/decide',
      body: <String, String>{'decision': decision.name},
    );
  }

  /* ---------------- decoding ---------------- */

  OcrDraft _draftFrom(dynamic data) {
    final json = data is Map<String, dynamic> ? data : const <String, dynamic>{};
    return OcrDraft(
      merchant: '${json['merchant'] ?? ''}',
      date: '${json['date'] ?? ''}',
      amount: '${json['amount'] ?? ''}',
      tax: '${json['tax'] ?? ''}',
      currency: '${json['currency'] ?? ''}',
      category: '${json['category'] ?? ''}',
      description: '${json['description'] ?? ''}',
    );
  }

  Map<String, String> _draftToJson(OcrDraft draft) => <String, String>{
        'merchant': draft.merchant,
        'date': draft.date,
        'amount': draft.amount,
        'tax': draft.tax,
        'currency': draft.currency,
        'category': draft.category,
        'description': draft.description,
      };

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
