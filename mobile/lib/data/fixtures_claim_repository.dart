import '../api/auth.dart';
import '../models/models.dart';
import 'claim_repository.dart';
import 'fixtures.dart';

/// Demo-mode [ClaimRepository]: pure delegation to [Fixtures], no network.
///
/// This is the default implementation everywhere (app boot, tests), so the
/// Phase 1 demo behaviour is preserved exactly and swapping in
/// [RestClaimRepository] later is a one-line change at the injection site.
class FixturesClaimRepository implements ClaimRepository {
  FixturesClaimRepository();

  OcrDraft? _savedDraft;

  /// Last draft handed to [saveDraft], readable so callers and tests can
  /// round-trip what the demo "persisted".
  OcrDraft? get savedDraft => _savedDraft;

  /* ------- synchronous seeds ------- */

  /// The demo claims, readable without a microtask hop. [AppState] seeds its
  /// caches from these so synchronous reads (first build, existing tests)
  /// still see the demo data.
  List<Claim> get demoClaims => Fixtures.claims;

  /// Demo counterpart of [demoClaims] for the approver inbox.
  List<InboxItem> get demoInbox => Fixtures.inbox;

  /* ------- ClaimRepository ------- */

  @override
  Future<AuthUser?> getCurrentUser() async => null;

  @override
  Future<AuthUser> signIn(String email, String password) async => AuthUser(
        id: 'demo-aulia',
        email: email,
        name: Fixtures.userName,
        role: 'employee',
      );

  @override
  Future<void> signOut() async {}

  @override
  Future<List<Claim>> listClaims(String employeeId) async => Fixtures.claims;

  @override
  Future<Claim?> claimById(String claimId) async => Fixtures.claimById(claimId);

  @override
  Future<List<InboxItem>> listInbox(String approverId) async => Fixtures.inbox;

  @override
  Future<OcrDraft> capture() async => Fixtures.initialDraft;

  @override
  Future<OcrDraft> saveDraft(OcrDraft draft) async {
    _savedDraft = draft;
    return draft;
  }
}
