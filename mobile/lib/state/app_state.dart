import 'dart:async';

import 'package:flutter/widgets.dart';

import '../data/fixtures.dart';
import '../models/models.dart';
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
/// queue), so it lives in a single notifier rather than in each screen. Nothing
/// is persisted: Phase 1 has no mobile API and no on-device store yet.
class AppState extends ChangeNotifier {
  // The backing fields are private, so they cannot be initializing formals of
  // a named parameter.
  AppState({AppVariant variant = AppVariant.standard, bool offline = false})
      // ignore: prefer_initializing_formals
      : _variant = variant,
        // ignore: prefer_initializing_formals
        _offline = offline;

  /// Wall-clock pacing of the fake OCR pass. Long enough to read the stage
  /// copy, short enough that the flow never feels blocked.
  static const Duration _scanTick = Duration(milliseconds: 190);
  static const int _scanStepPercent = 11;
  static const Duration _syncDuration = Duration(milliseconds: 1400);

  AppVariant _variant;
  AppVariant get variant => _variant;
  set variant(AppVariant value) {
    if (_variant == value) return;
    _variant = value;
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

    final completer = Completer<bool>();
    _scanTimer = Timer.periodic(_scanTick, (timer) {
      _scanPercent += _scanStepPercent;
      if (_scanPercent >= 100) {
        _scanPercent = 100;
        timer.cancel();
        _scanTimer = null;
        _scanning = false;
        notifyListeners();
        if (!completer.isCompleted) completer.complete(true);
        return;
      }
      notifyListeners();
    });
    return completer.future;
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

  /// Add the confirmed line to the open draft claim.
  void confirmLine() {
    _added = true;
    _scanPercent = 0;
    notifyListeners();
  }

  /// Submit, or queue the submission when there is no network.
  /// Returns true when it went straight to the approver.
  bool submitClaim() {
    if (online) {
      _submitted = true;
      notifyListeners();
      return true;
    }
    notifyListeners();
    return false;
  }

  /* ---------------- sync queue ---------------- */

  bool _syncing = false;
  bool get syncing => _syncing;

  bool _synced = false;
  bool get synced => _synced;

  int get pendingQueueCount => _synced ? 0 : Fixtures.queue.length;

  QueueState queueStateAt(int index) {
    if (_synced) return QueueState.synced;
    // The run uploads top-down, so only the head item shows as in flight.
    if (_syncing && index == 0) return QueueState.syncing;
    return QueueState.queued;
  }

  String get queueSummary => _synced
      ? 'All caught up — nothing queued'
      : '$pendingQueueCount receipt${pendingQueueCount == 1 ? '' : 's'} queued · '
          '${formatIdr(Fixtures.queueHeldTotal)} held locally';

  /// Upload everything held on device. No-op unless there is a network and
  /// something is actually queued; the caller reports why.
  Future<bool> syncNow() async {
    if (!online || _synced) return false;
    _syncing = true;
    notifyListeners();
    await Future<void>.delayed(_syncDuration);
    _syncing = false;
    _synced = true;
    notifyListeners();
    return true;
  }

  /* ---------------- approver inbox ---------------- */

  int _decided = 0;

  /// Decisions taken this session, consumed from the top of the inbox.
  int get decided => _decided;

  List<InboxItem> get inbox => Fixtures.inbox.skip(_decided).toList();

  void decide() {
    _decided += 1;
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
    return <Claim>[openDraft, ...Fixtures.claims];
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

  void signIn() {
    _signedIn = true;
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
