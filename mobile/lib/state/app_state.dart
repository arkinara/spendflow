import 'dart:async';

import 'package:flutter/widgets.dart';

import '../api/auth.dart' as auth_api;
import '../api/errors.dart';
import '../data/claim_repository.dart';
import '../data/fixtures.dart';
import '../data/fixtures_claim_repository.dart';
import '../models/models.dart';
import '../storage/local_store.dart';
import '../util/currency.dart';

/// Layout and behaviour variants carried over from the design doc, so the
/// alternatives can be reviewed on a device instead of in a browser.
enum AppVariant {
  standard('Default'),
  captureMultishot('Capture · multi-page'),
  syncQuiet('Offline · quiet'),
  homeCompact('Home · dense ledger'),
  homeEditorial('Home · editorial');

  const AppVariant(this.label);

  final String label;
}

/// Which stage of the scan the progress copy is describing.
enum ScanStage {
  sharpening('Sharpening and de-skewing…'),
  reading('Reading text…'),
  extracting('Extracting fields…'),
  done('Done');

  const ScanStage(this.label);

  final String label;
}

/// Whole-app state for the mobile client.
///
/// The capture → confirm → draft → submit → sync journey spans several routes
/// but shares one piece of state (the OCR draft, the network mode, the local
/// queue), so it lives in a single notifier rather than in each screen.
/// Since #93 the queue, draft, inbox and settings persist through a
/// [LocalStore] so a process kill is recoverable; build via [AppState.create]
/// to hydrate before the first frame.
class AppState extends ChangeNotifier {
  // The backing fields are private, so they cannot be initializing formals of
  // a named parameter.
  AppState({
    AppVariant variant = AppVariant.standard,
    bool offline = false,
    ClaimRepository? repository,
    LocalStore? store,
  })  // ignore: prefer_initializing_formals
  : repository = repository ?? FixturesClaimRepository(),
        // ignore: prefer_initializing_formals
        _variant = variant,
        // ignore: prefer_initializing_formals
        _offline = offline,
        // ignore: prefer_initializing_formals
        _store = store {
    // Demo mode seeds synchronously so reads before any await — first build,
    // existing tests — still see the fixture data. A REST repository starts
    // empty and fills via [loadClaims].
    final demo = this.repository;
    if (demo is FixturesClaimRepository) {
      _employeeClaims = demo.demoClaims;
      _inboxItems = demo.demoInbox;
    }
  }

  /// Boot path (#93): init the store, construct the state, then hydrate the
  /// persisted queue / draft / inbox / settings. Returns once hydration is
  /// done, so [main] can build the first frame on fully recovered state.
  static Future<AppState> create({
    AppVariant variant = AppVariant.standard,
    bool offline = false,
    ClaimRepository? repository,
    LocalStore? store,
  }) async {
    final hydratedStore = store ?? InMemoryStore();
    await hydratedStore.init();
    final state = AppState(
      variant: variant,
      offline: offline,
      repository: repository,
      store: hydratedStore,
    );
    await state._hydrate();
    return state;
  }

  /* ---------------- persistence (#93) ---------------- */

  static const String _variantKey = 'variant';
  static const String _offlineKey = 'offline';
  static const String _queueKey = 'queue';
  static const String _draftKey = 'draft';
  static const String _inboxKey = 'inbox';

  /// Null in pre-persistence callers (tests, bare constructors) — nothing is
  /// written and the in-memory behaviour is unchanged.
  final LocalStore? _store;

  /// Load persisted state over the constructor's defaults. A corrupt or
  /// partially-written blob logs and is skipped: the in-memory defaults win
  /// rather than crashing the boot (negative AC #93).
  Future<void> _hydrate() async {
    final store = _store;
    if (store == null) return;
    try {
      final variantName = await store.readString(_variantKey);
      if (variantName != null) {
        for (final candidate in AppVariant.values) {
          if (candidate.name == variantName) _variant = candidate;
        }
      }
      final offlineRaw = await store.readString(_offlineKey);
      if (offlineRaw != null) _offline = offlineRaw == 'true';
      final queue = await store.readList(_queueKey);
      if (queue != null) {
        _queue = queue.map(QueueItem.fromJson).toList();
        // An empty persisted queue means a sync finished before the kill.
        if (_queue.isEmpty) _synced = true;
      }
      final draft = await store.readMap(_draftKey);
      if (draft != null) {
        _draft = OcrDraft.fromJson(draft);
        _added = draft['added'] == true;
      }
      final inbox = await store.readList(_inboxKey);
      if (inbox != null) {
        _inboxItems = inbox.map(InboxItem.fromJson).toList();
      }
    } catch (error, stack) {
      debugPrint('SpendFlow persistence: hydration failed: $error\n$stack');
    }
    notifyListeners();
  }

  /// Writes are fire-and-forget with their errors swallowed after logging —
  /// a failed write (disk full, corrupt store) must preserve the in-memory
  /// session rather than crash it (negative AC #93). They are also routed to
  /// save points (submit / confirm / sync / toggle), not per keystroke.
  void _write(Future<void> Function(LocalStore store) action) {
    final store = _store;
    if (store == null) return;
    unawaited(() async {
      try {
        await action(store);
      } catch (error) {
        debugPrint('SpendFlow persistence: write failed: $error');
      }
    }());
  }

  void _persistSettings() => _write((store) async {
        await store.writeString(_variantKey, _variant.name);
        await store.writeString(_offlineKey, _offline ? 'true' : 'false');
      });

  void _persistDraft() => _write((store) async {
        await store.writeMap(_draftKey, <String, dynamic>{
          'added': _added,
          ..._draft.toJson(),
        });
      });

  void _clearPersistedDraft() => _write((store) => store.delete(_draftKey));

  void _persistInbox() => _write(
      (store) => store.writeList(_inboxKey, _inboxItems.map((i) => i.toJson()).toList()));

  void _clearPersistedQueue() =>
      _write((store) => store.writeList(_queueKey, const <Map<String, dynamic>>[]));

  /// Data seam for every claim read (#91). Screens depend on this, never on
  /// `Fixtures` or the HTTP client.
  final ClaimRepository repository;

  /// Claims loaded from [repository]; fixture-seeded in demo mode.
  List<Claim> _employeeClaims = const <Claim>[];

  /// Approver inbox loaded from [repository]; fixture-seeded in demo mode.
  List<InboxItem> _inboxItems = const <InboxItem>[];

  /// Employee id claims and inbox are scoped to. Fixtures ignore it; the
  /// REST repository passes it as `employee_id`.
  String get employeeId => currentUser?.id ?? 'demo-aulia';

  /// Pull claims + inbox from the repository. Cheap in demo mode (same
  /// fixtures); the live mode runs it on login and route entry (#91b/#91c).
  Future<void> loadClaims() async {
    _employeeClaims = await repository.listClaims(employeeId);
    _inboxItems = await repository.listInbox(employeeId);
    notifyListeners();
  }

  /// Wall-clock pacing of the fake OCR pass. Long enough to read the stage
  /// copy, short enough that the flow never feels blocked.
  static const Duration _scanTick = Duration(milliseconds: 190);
  static const int _scanStepPercent = 11;

  AppVariant _variant;
  AppVariant get variant => _variant;
  set variant(AppVariant value) {
    if (_variant == value) return;
    _variant = value;
    _persistSettings();
    notifyListeners();
  }

  /* ---------------- network ---------------- */

  bool _offline;
  bool get offline => _offline;
  bool get online => !_offline;

  /// Airplane-mode toggle. Capture keeps working either way — that is the
  /// point of the offline queue.
  void toggleOnline() {
    _offline = !_offline;
    if (_offline) _synced = false;
    _persistSettings();
    notifyListeners();
  }

  /* ---------------- capture ---------------- */

  bool _torch = false;
  bool get torch => _torch;

  bool _autoCrop = true;
  bool get autoCrop => _autoCrop;

  int _shots = 1;

  /// Pages captured so far in the multi-page variant.
  int get shots => _shots;

  void toggleTorch() {
    _torch = !_torch;
    notifyListeners();
  }

  void toggleAutoCrop() {
    _autoCrop = !_autoCrop;
    notifyListeners();
  }

  void resetCapture() {
    _scanTimer?.cancel();
    _scanTimer = null;
    _shots = 1;
    _scanPercent = 0;
    _scanning = false;
    notifyListeners();
  }

  /* ---------------- scanning ---------------- */

  Timer? _scanTimer;
  bool _scanning = false;
  bool get scanning => _scanning;

  int _scanPercent = 0;
  int get scanPercent => _scanPercent;

  ScanStage get scanStage {
    if (_scanPercent >= 100) return ScanStage.done;
    if (_scanPercent > 70) return ScanStage.extracting;
    if (_scanPercent > 35) return ScanStage.reading;
    return ScanStage.sharpening;
  }

  String get scanSubtitle => online
      ? 'On-device pass first, then a cloud check for accuracy.'
      : 'Offline — reading on device. Queued for a cloud re-check later.';

  /// Press the shutter.
  ///
  /// In the multi-page variant the first two presses stack pages instead of
  /// scanning, so three sheets of a folded receipt merge into one expense.
  /// Returns true once the scan has finished and the confirmation screen should
  /// take over; false when the press only added a page.
  Future<bool> shoot() async {
    if (_variant == AppVariant.captureMultishot && _shots < 3) {
      _shots += 1;
      notifyListeners();
      return false;
    }

    _scanTimer?.cancel();
    _scanning = true;
    _scanPercent = _scanStepPercent;
    notifyListeners();

    // The repository call owns the outcome (#91): the timer below only paces
    // the staged progress copy while the OCR pass runs. The scan finishes
    // when the wall-clock pace is spent AND the draft has arrived.
    final reading = repository.capture();

    final completer = Completer<bool>();
    _scanTimer = Timer.periodic(_scanTick, (timer) async {
      _scanPercent += _scanStepPercent;
      if (_scanPercent < 100) {
        notifyListeners();
        return;
      }
      try {
        _draft = await reading;
      } on ApiException catch (error, stack) {
        timer.cancel();
        _scanTimer = null;
        _scanning = false;
        _scanPercent = 0;
        notifyListeners();
        if (!completer.isCompleted) completer.completeError(error, stack);
        return;
      }
      _scanPercent = 100;
      timer.cancel();
      _scanTimer = null;
      _scanning = false;
      notifyListeners();
      if (!completer.isCompleted) completer.complete(true);
    });
    return completer.future;
  }

  /// Run the OCR pass through the repository and adopt the resulting draft
  /// as the current one. Throws [ApiException] when the pass fails; callers
  /// surface the message and let the user retake.
  Future<OcrDraft> capture() async {
    final draft = await repository.capture();
    _draft = draft;
    _persistDraft();
    notifyListeners();
    return draft;
  }

  /// Persist the edited draft through the repository and keep the stored
  /// version as the current draft.
  Future<OcrDraft> saveDraft(OcrDraft draft) async {
    final saved = await repository.saveDraft(draft);
    _draft = saved;
    _persistDraft();
    notifyListeners();
    return saved;
  }

  /* ---------------- OCR draft ---------------- */

  OcrDraft _draft = Fixtures.initialDraft;
  OcrDraft get draft => _draft;

  OcrFieldKey _focusedField = OcrFieldKey.amount;

  /// The field being edited — its source crop highlights alongside it.
  OcrFieldKey get focusedField => _focusedField;

  void focusField(OcrFieldKey key) {
    if (_focusedField == key) return;
    _focusedField = key;
    notifyListeners();
  }

  void setField(OcrFieldKey key, String value) {
    _draft = _draft.withField(key, value);
    notifyListeners();
  }

  void setDescription(String value) {
    _draft = _draft.copyWith(description: value);
    notifyListeners();
  }

  /// Step to the next category. The cap check re-runs against the new one.
  void cycleCategory() {
    final index =
        Fixtures.categories.indexWhere((c) => c.name == _draft.category);
    final next = Fixtures.categories[(index + 1) % Fixtures.categories.length];
    _draft = _draft.copyWith(category: next.name);
    notifyListeners();
  }

  ExpenseCategory get draftCategory => Fixtures.categoryByName(_draft.category);

  int get draftAmount => parseIdr(_draft.amount);

  /// Over the category's per-item cap. The line still submits; Finance picks it
  /// up as an exception.
  bool get overCap {
    final cap = draftCategory.cap;
    return cap != null && draftAmount > cap;
  }

  int get capExcess {
    final cap = draftCategory.cap;
    if (cap == null) return 0;
    final excess = draftAmount - cap;
    return excess > 0 ? excess : 0;
  }

  String get capMessage {
    final cap = draftCategory.cap ?? 0;
    return '${draftCategory.name} cap is ${formatIdr(cap)} per item — '
        '${formatIdr(capExcess)} over. Submit anyway and Finance reviews it as '
        'an exception.';
  }

  /* ---------------- open draft claim ---------------- */

  bool _added = false;

  /// The confirmed OCR line has been added to the open draft claim.
  bool get added => _added;

  bool _submitted = false;
  bool get submitted => _submitted;

  List<ClaimLine> get draftLines {
    if (!_added) return Fixtures.draftBaseLines;
    final category = draftCategory;
    return <ClaimLine>[
      ...Fixtures.draftBaseLines,
      ClaimLine(
        code: category.code,
        description: _draft.description.isEmpty
            ? _draft.category
            : _draft.description,
        meta: '${_draft.category} · ${_draft.date} · ${_draft.merchant}',
        amount: draftAmount,
        file: '${Fixtures.capturedFileName}.jpg',
        source: LineSource.ocr,
        flagText: overCap
            ? 'Over the ${formatIdr(category.cap ?? 0)} '
                '${category.name.toLowerCase()} cap — routes to Finance '
                'exception review.'
            : null,
      ),
    ];
  }

  int get draftTotal =>
      draftLines.fold(0, (total, line) => total + line.amount);

  int get flaggedCount => draftLines.where((l) => l.isFlagged).length;

  /// Add the confirmed line to the open draft claim. A save point (#93):
  /// the confirmed draft survives a process kill from here on.
  void confirmLine() {
    _added = true;
    _scanPercent = 0;
    _persistDraft();
    notifyListeners();
  }

  /// Submit, or queue the submission when there is no network.
  /// Returns true when it went straight to the approver.
  bool submitClaim() {
    if (online) {
      _submitted = true;
      // The draft is now a real submitted claim, not a draft (#93).
      _clearPersistedDraft();
      notifyListeners();
      return true;
    }
    notifyListeners();
    return false;
  }

  /// Submit the confirmed draft through the repository (#92). The claim comes
  /// back stored — the success screen renders it; errors surface via
  /// [ApiException].
  Future<SubmissionResult> submit(OcrDraft draft) async {
    final result = await repository.submit(draft);
    _lastSubmission = result;
    _submitted = true;
    // Submitted claims live on the backend — no draft left to recover (#93).
    _clearPersistedDraft();
    notifyListeners();
    return result;
  }

  /// The claim returned by the most recent successful repository submit, if
  /// any — the success screen's data source.
  Claim? get lastSubmittedClaim => _lastSubmission?.claim;

  SubmissionResult? _lastSubmission;

  /* ---------------- sync queue ---------------- */

  bool _syncing = false;
  bool get syncing => _syncing;

  bool _synced = false;
  bool get synced => _synced;

  /// Count the last successful sync pushed, straight from the repository —
  /// the queue banner reports it back.
  int _lastSyncedCount = 0;
  int get lastSyncedCount => _lastSyncedCount;

  /// Locally-held captures. Seeded from the demo fixture so the offline
  /// story is visible without a backend; replaced by the hydrated copy on
  /// boot (#93) once anything was ever persisted.
  List<QueueItem> _queue = Fixtures.queue;

  int get pendingQueueCount => _synced ? 0 : _queue.length;

  /// Rows the queue screen renders. Backed by the persisted copy (#93) —
  /// killing the app no longer drops the offline queue.
  List<QueueItem> get queuedItems =>
      _synced ? const <QueueItem>[] : _queue;

  int get _queueHeldTotal =>
      _queue.fold(0, (total, item) => total + item.amount);

  QueueState queueStateAt(int index) {
    if (_synced) return QueueState.synced;
    // The run uploads top-down, so only the head item shows as in flight.
    if (_syncing && index == 0) return QueueState.syncing;
    return QueueState.queued;
  }

  String get queueSummary => _synced
      ? 'All caught up — nothing queued'
      : '$pendingQueueCount receipt${pendingQueueCount == 1 ? '' : 's'} queued · '
          '${formatIdr(_queueHeldTotal)} held locally';

  /// Upload everything held on device through the repository (#92). No-op
  /// unless there is a network and something is actually queued; the caller
  /// reports why. Throws [ApiException] when the backend rejects the sync —
  /// the queue stays intact so the next press retries.
  Future<bool> syncNow() async {
    if (!online || _synced) return false;
    _syncing = true;
    notifyListeners();
    try {
      _lastSyncedCount = await repository.sync();
    } on ApiException {
      _syncing = false;
      notifyListeners();
      rethrow;
    }
    _syncing = false;
    _synced = true;
    // Save point (#93): a finished sync clears the persisted queue so a
    // relaunch boots "all caught up" instead of replaying uploaded items.
    _clearPersistedQueue();
    notifyListeners();
    return true;
  }

  /* ---------------- approver inbox ---------------- */

  List<InboxItem> get inbox => _inboxItems;

  /// Decide one inbox item through the repository (#92) and drop it from the
  /// local list on success. Omitting the id keeps the Phase 1 "consume from
  /// the top" behaviour (first visible item, approved).
  Future<void> decide([
    String? inboxItemId,
    Decision decision = Decision.approve,
  ]) async {
    final id = inboxItemId ??
        (_inboxItems.isNotEmpty ? _inboxItems.first.id : null);
    if (id == null) return;
    await repository.decide(id, decision);
    _inboxItems = _inboxItems.where((item) => item.id != id).toList();
    // Save point (#93): the decided-away item stays decided-away after a
    // process kill, even before the next [loadClaims] refresh.
    _persistInbox();
    notifyListeners();
  }

  /* ---------------- home metrics ---------------- */

  int get pendingTotal =>
      Fixtures.pendingBaseTotal + (_submitted ? draftTotal : 0);

  int get reimbursedTotal => Fixtures.reimbursedTotal;

  /// Rows for the home ledger: the live draft first, then the fixture claims.
  List<Claim> get homeClaims {
    final openDraft = Claim(
      id: Fixtures.draftClaimId,
      code: 'Q3',
      title: Fixtures.draftClaimTitle,
      place: 'Jakarta',
      status: _submitted ? ClaimStatus.pending : ClaimStatus.draft,
      amount: draftTotal,
      dateLabel: _submitted ? '28 Jul' : 'Draft',
      itemCount: draftLines.length,
      receiptCount: draftLines.where((l) => l.file != null).length,
      headline: '${Fixtures.draftClaimTrip} · ${_submitted ? 'submitted 28 Jul 2026' : 'not submitted'}',
      slaLabel: _submitted ? 'SLA 2 days left' : null,
      lines: draftLines,
      timeline: <TimelineEntry>[
        const TimelineEntry(
          title: 'Created',
          actor: Fixtures.userName,
          time: '26 Jul, 10:04',
          tone: TimelineTone.done,
        ),
        if (_submitted)
          const TimelineEntry(
            title: 'Submitted for approval',
            actor: Fixtures.userName,
            time: '28 Jul, 09:12',
            tone: TimelineTone.done,
          ),
        if (_submitted)
          const TimelineEntry(
            title: 'Awaiting ${Fixtures.approverName}',
            actor: '${Fixtures.approverRole} · SLA 2 days left',
            time: 'now',
            tone: TimelineTone.waiting,
          )
        else
          const TimelineEntry(
            title: 'Not submitted yet',
            actor: 'Add your receipts, then submit',
            time: '—',
            tone: TimelineTone.pending,
          ),
      ],
    );
    return <Claim>[openDraft, ..._employeeClaims];
  }

  Claim? claimById(String id) {
    for (final claim in homeClaims) {
      if (claim.id == id) return claim;
    }
    return null;
  }

  /* ---------------- session ---------------- */

  bool _signedIn = false;
  bool get signedIn => _signedIn;

  auth_api.AuthUser? _currentUser;

  /// The authenticated user, populated by the boot-time `/api/me` probe or a
  /// real sign-in — null when only the Phase 1 demo hand-off has run.
  auth_api.AuthUser? get currentUser => _currentUser;

  /// Demo hand-off sign-in (Phase 1 behaviour). Passing `false` is the 401
  /// handler's sign-out signal.
  void signIn([bool signedIn = true]) {
    _signedIn = signedIn;
    if (!signedIn) _currentUser = null;
    notifyListeners();
  }

  /// Sign in with a real backend session behind it.
  void signInAs(auth_api.AuthUser user) {
    _currentUser = user;
    _signedIn = true;
    notifyListeners();
  }

  /// Invalidate the server-side session, then clear local state.
  Future<void> signOut() async {
    await repository.signOut();
    _currentUser = null;
    _signedIn = false;
    notifyListeners();
  }

  /// Cold-start session probe: `GET /api/me` with the session cookie.
  ///
  /// 200 → user stored and signed in; 401 → signed out; network/BE error →
  /// signed out but harmless (offline capture works without a session).
  Future<void> bootstrap() async {
    try {
      final user = await repository.getCurrentUser();
      _currentUser = user;
      _signedIn = user != null;
    } on ApiException {
      _signedIn = false;
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _scanTimer?.cancel();
    super.dispose();
  }
}

/// Makes [AppState] available to the widget tree and rebuilds dependents when
/// it changes.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({required AppState state, required super.child, super.key})
      : super(notifier: state);

  static AppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'No AppScope found in context');
    return scope!.notifier!;
  }

  /// Read without subscribing — for callbacks that only fire actions.
  static AppState read(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'No AppScope found in context');
    return scope!.notifier!;
  }
}
