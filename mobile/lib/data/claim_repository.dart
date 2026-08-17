import '../api/auth.dart';
import '../models/models.dart';

/// The one seam the UI depends on for claim data (#91).
///
/// Screens and [AppState] talk to this interface only — never to `Fixtures`
/// or [HttpClient] directly — so the demo (fixtures) and live (REST) modes
/// are interchangeable and #91b/#91c can add methods without touching call
/// sites again.
abstract class ClaimRepository {
  /// Signed-in user from the session cookie, or null when there is none.
  Future<AuthUser?> getCurrentUser();

  /// Exchange email + password for a session. Throws [ApiException] when the
  /// backend is unreachable or rejects the credentials.
  Future<AuthUser> signIn(String email, String password);

  /// Invalidate the server-side session. Always resolves.
  Future<void> signOut();

  /// Every claim the employee owns.
  Future<List<Claim>> listClaims(String employeeId);

  /// One claim by id, or null when the backend does not know it.
  Future<Claim?> claimById(String claimId);

  /// Approver inbox pending decision.
  Future<List<InboxItem>> listInbox(String approverId);

  /// Run the OCR pass over the captured pages and hand back the editable
  /// draft (#91). The demo implementation returns the fixture draft; the
  /// live one calls the mock OCR endpoint (real OCR is #93).
  Future<OcrDraft> capture();

  /// Persist the edited draft after confirmation. Returns the stored draft.
  Future<OcrDraft> saveDraft(OcrDraft draft);
}
