import 'dart:typed_data';

import '../api/auth.dart';
import '../models/models.dart';

/// Approver verdict on one inbox item (#92).
enum Decision { approve, reject, returnForRevision }

/// What a successful submit hands back (#92): the stored claim plus its
/// submission status ('submitted' when it went straight to the approver).
class SubmissionResult {
  const SubmissionResult({required this.claim, this.status = 'submitted'});

  final Claim claim;
  final String status;
}

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
  ///
  /// When [cameraBytes] is provided (#103) the repository first uploads the
  /// captured frame to the backend's receipt storage, then runs the on-device
  /// OCR pass over the same bytes — the upload is best-effort (a failed or
  /// not-yet-landed upload still yields the OCR draft; the receipt URL is a
  /// nice-to-have, not a blocker).
  Future<OcrDraft> capture({Uint8List? cameraBytes});

  /// Persist the edited draft after confirmation. Returns the stored draft.
  Future<OcrDraft> saveDraft(OcrDraft draft);

  /// Submit the confirmed draft as a claim (#92).
  Future<SubmissionResult> submit(OcrDraft draft);

  /// Push every locally-held (offline-queued) submission to the backend and
  /// return the count successfully synced (#92).
  Future<int> sync();

  /// Record the approver's verdict on one inbox item (#92). Throws
  /// [ApiException] when the backend rejects or is unreachable.
  Future<void> decide(String inboxItemId, Decision decision);
}
