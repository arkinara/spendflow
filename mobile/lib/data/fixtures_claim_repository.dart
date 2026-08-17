import '../api/auth.dart';
import '../models/models.dart';
import '../util/currency.dart';
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

  /// Inbox is a const fixture, so [decide] copies it on first mutation and
  /// [listInbox] serves the copy from then on. Until that point it hands back
  /// the fixture list itself (the `same` identity tests rely on).
  List<InboxItem>? _inboxView;

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
  Future<List<InboxItem>> listInbox(String approverId) async =>
      _inboxView ?? Fixtures.inbox;

  @override
  Future<OcrDraft> capture() async => Fixtures.initialDraft;

  @override
  Future<OcrDraft> saveDraft(OcrDraft draft) async {
    _savedDraft = draft;
    return draft;
  }

  @override
  Future<SubmissionResult> submit(OcrDraft draft) async {
    final amount = parseIdr(draft.amount);
    final category = Fixtures.categoryByName(draft.category);
    final lines = <ClaimLine>[
      ...Fixtures.draftBaseLines,
      ClaimLine(
        code: category.code,
        description:
            draft.description.isEmpty ? draft.category : draft.description,
        meta: '${draft.category} · ${draft.date} · ${draft.merchant}',
        amount: amount,
        file: '${Fixtures.capturedFileName}.jpg',
        source: LineSource.ocr,
      ),
    ];
    final total = lines.fold(0, (sum, line) => sum + line.amount);
    return SubmissionResult(
      claim: Claim(
        id: Fixtures.draftClaimId,
        code: 'Q3',
        title: Fixtures.draftClaimTitle,
        place: 'Jakarta',
        status: ClaimStatus.pending,
        amount: total,
        dateLabel: '28 Jul',
        itemCount: lines.length,
        receiptCount: lines.where((l) => l.file != null).length,
        headline: '${Fixtures.draftClaimTrip} · submitted 28 Jul 2026',
        slaLabel: 'SLA 2 days left',
        lines: lines,
        timeline: const <TimelineEntry>[
          TimelineEntry(
            title: 'Created',
            actor: Fixtures.userName,
            time: '26 Jul, 10:04',
            tone: TimelineTone.done,
          ),
          TimelineEntry(
            title: 'Submitted for approval',
            actor: Fixtures.userName,
            time: '28 Jul, 09:12',
            tone: TimelineTone.done,
          ),
          TimelineEntry(
            title: 'Awaiting ${Fixtures.approverName}',
            actor: '${Fixtures.approverRole} · SLA 2 days left',
            time: 'now',
            tone: TimelineTone.waiting,
          ),
        ],
      ),
    );
  }

  @override
  Future<int> sync() async => Fixtures.queue.length;

  @override
  Future<void> decide(String inboxItemId, Decision decision) async {
    final list = _inboxView ??= List<InboxItem>.of(Fixtures.inbox);
    list.removeWhere((item) => item.id == inboxItemId);
  }
}
