import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/api/auth.dart';
import 'package:spendflow_mobile/data/claim_repository.dart';
import 'package:spendflow_mobile/data/fixtures.dart';
import 'package:spendflow_mobile/data/fixtures_claim_repository.dart';
import 'package:spendflow_mobile/data/mlkit_ocr_pass.dart';
import 'package:spendflow_mobile/data/mock_ocr_pass.dart';
import 'package:spendflow_mobile/data/rest_claim_repository.dart';
import 'package:spendflow_mobile/models/models.dart';
import 'package:spendflow_mobile/state/app_state.dart';
import 'package:spendflow_mobile/storage/local_store.dart';

/// Records every call so an injected [AppState] can be proven to read its
/// claims through the repository rather than straight from [Fixtures].
class _RecordingRepository implements ClaimRepository {
  int listClaimsCalls = 0;
  int captureCalls = 0;
  int saveDraftCalls = 0;
  int syncCalls = 0;
  int decideCalls = 0;
  String? lastDecidedId;
  Decision? lastDecision;
  OcrDraft? savedDraft;

  /// The bytes handed to [capture] on its most recent call (#103) — proves
  /// captureFromCamera routes the camera frame through the repository.
  Uint8List? lastCameraBytes;

  // capture result is a distinct draft (different merchant + amount) so
  // the test can assert state.draft is exactly what the repository returned.
  final OcrDraft captureResult = Fixtures.initialDraft.copyWith(
    merchant: 'Kopi Toko Djawa',
    amount: '24.000',
  );

  @override
  Future<AuthUser?> getCurrentUser() async => null;

  @override
  Future<AuthUser> signIn(String email, String password) async => AuthUser(
        id: 'u1',
        email: email,
        name: 'Tester',
        role: 'employee',
      );

  @override
  Future<void> signOut() async {}

  @override
  Future<List<Claim>> listClaims(String employeeId) async {
    listClaimsCalls += 1;
    return const <Claim>[];
  }

  @override
  Future<Claim?> claimById(String claimId) async => null;

  @override
  Future<List<InboxItem>> listInbox(String approverId) async =>
      Fixtures.inbox;

  @override
  Future<OcrDraft> capture({Uint8List? cameraBytes}) async {
    captureCalls += 1;
    lastCameraBytes = cameraBytes;
    return captureResult;
  }

  @override
  Future<OcrDraft> saveDraft(OcrDraft draft) async {
    saveDraftCalls += 1;
    savedDraft = draft;
    return draft;
  }

  @override
  Future<SubmissionResult> submit(OcrDraft draft) async =>
      SubmissionResult(claim: Fixtures.claims.first);

  @override
  Future<int> sync() async {
    syncCalls += 1;
    return Fixtures.queue.length;
  }

  @override
  Future<void> decide(String inboxItemId, Decision decision) async {
    decideCalls += 1;
    lastDecidedId = inboxItemId;
    lastDecision = decision;
  }
}

/// A recording repository whose [capture] result is distinctive, proving the
/// camera-frame path routes through the repository rather than the fixtures.
void main() {
  group('policy caps', () {
    test('the scanned meal is over the Meals cap', () {
      final state = AppState();
      // 391.830 read off the receipt vs the 350.000 per-item Meals cap.
      expect(state.draftAmount, 391830);
      expect(state.overCap, isTrue);
      expect(state.capExcess, 41830);
      expect(state.capMessage, contains('Rp 350.000'));
      expect(state.capMessage, contains('Rp 41.830'));
    });

    test('the same amount clears an uncapped category', () {
      final state = AppState();
      while (state.draftCategory.name != 'Flight') {
        state.cycleCategory();
      }
      expect(state.overCap, isFalse);
      expect(state.capExcess, 0);
    });

    test('lowering the amount below the cap clears the flag', () {
      final state = AppState();
      state.setField(OcrFieldKey.amount, '120.000');
      expect(state.overCap, isFalse);
    });
  });

  group('draft claim', () {
    test('confirming the OCR line adds it to the open draft', () {
      final state = AppState();
      expect(state.draftLines, hasLength(2));
      expect(state.draftTotal, 4250000);

      state.confirmLine();

      expect(state.draftLines, hasLength(3));
      expect(state.draftTotal, 4250000 + 391830);
      final added = state.draftLines.last;
      expect(added.source, LineSource.ocr);
      expect(added.description, 'Team dinner with PT Nusantara');
      expect(added.file, 'IMG_0421.jpg');
    });

    test('an over-cap line is flagged for Finance, not blocked', () {
      final state = AppState()..confirmLine();
      expect(state.flaggedCount, 1);
      expect(state.draftLines.last.flagText, contains('meals cap'));
      // Still submittable — the exception routes, it does not stop the claim.
      expect(state.submitClaim(), isTrue);
      expect(state.submitted, isTrue);
    });

    test('a within-cap line carries no flag', () {
      final state = AppState()
        ..setField(OcrFieldKey.amount, '150.000')
        ..confirmLine();
      expect(state.flaggedCount, 0);
      expect(state.draftLines.last.flagText, isNull);
    });
  });

  group('offline behaviour', () {
    test('submitting offline does not send the claim', () {
      final state = AppState(offline: true);
      expect(state.submitClaim(), isFalse);
      expect(state.submitted, isFalse);
    });

    test('sync is a no-op while offline', () async {
      final state = AppState(offline: true);
      expect(await state.syncNow(), isFalse);
      expect(state.synced, isFalse);
      expect(state.pendingQueueCount, Fixtures.queue.length);
    });

    test('sync uploads the queue when back online', () async {
      final state = AppState();
      expect(state.queueStateAt(0), QueueState.queued);

      final future = state.syncNow();
      expect(state.syncing, isTrue);
      expect(state.queueStateAt(0), QueueState.syncing);
      expect(state.queueStateAt(1), QueueState.queued);

      expect(await future, isTrue);
      expect(state.synced, isTrue);
      expect(state.pendingQueueCount, 0);
      expect(state.queueStateAt(0), QueueState.synced);
      expect(state.queueSummary, 'All caught up — nothing queued');
    });

    test('dropping offline again invalidates the synced state', () async {
      final state = AppState();
      await state.syncNow();
      expect(state.synced, isTrue);

      state.toggleOnline();

      expect(state.offline, isTrue);
      expect(state.synced, isFalse);
      expect(state.pendingQueueCount, Fixtures.queue.length);
    });
  });

  group('home ledger', () {
    test('the open draft leads the list and tracks its own total', () {
      final state = AppState();
      final claims = state.homeClaims;
      expect(claims.first.id, Fixtures.draftClaimId);
      expect(claims.first.status, ClaimStatus.draft);
      expect(claims, hasLength(Fixtures.claims.length + 1));

      state
        ..confirmLine()
        ..submitClaim();

      final after = state.homeClaims.first;
      expect(after.status, ClaimStatus.pending);
      expect(after.amount, 4250000 + 391830);
    });

    test('pending total picks up the claim once it is submitted', () {
      final state = AppState();
      expect(state.pendingTotal, Fixtures.pendingBaseTotal);

      state.submitClaim();

      expect(state.pendingTotal, Fixtures.pendingBaseTotal + state.draftTotal);
    });

    test('claims are addressable by reference', () {
      final state = AppState();
      expect(state.claimById('EXP-2026-1001')?.title,
          'Q2 Client Visit – Jakarta');
      expect(state.claimById('nope'), isNull);
    });
  });

  group('approver inbox', () {
    test('deciding consumes the item from the top', () async {
      final state = AppState();
      expect(state.inbox, hasLength(Fixtures.inbox.length));

      await state.decide();

      expect(state.inbox, hasLength(Fixtures.inbox.length - 1));
      expect(state.inbox.first.submitter, 'Bima Nugroho');
    });
  });

  group('repository injection', () {
    test('the default repository is the fixtures demo implementation', () {
      expect(AppState().repository, isA<FixturesClaimRepository>());
    });

    test('the default ocrPass is MlKitOcrPass for the REST repository and '
        'MockOcrPass otherwise (#99)', () {
      expect(AppState(repository: RestClaimRepository()).ocrPass,
          isA<MlKitOcrPass>());
      expect(AppState().ocrPass, isA<MockOcrPass>());
    });

    test('loadClaims reads claims through the injected repository', () async {
      final repo = _RecordingRepository();
      final state = AppState(repository: repo);

      expect(state.homeClaims, hasLength(1)); // draft only, repo still empty

      await state.loadClaims();

      expect(repo.listClaimsCalls, 1);
      expect(state.homeClaims, hasLength(1));
    });

    test('capture delegates to repository.capture and adopts the draft',
        () async {
      final repo = _RecordingRepository();
      final state = AppState(repository: repo);

      final draft = await state.capture();

      expect(repo.captureCalls, 1);
      expect(draft, same(repo.captureResult));
      expect(state.draft, same(repo.captureResult));
    });

    test('saveDraft delegates to repository.saveDraft', () async {
      final repo = _RecordingRepository();
      final state = AppState(repository: repo);
      final edited =
          Fixtures.initialDraft.copyWith(description: 'Edited dinner');

      await state.saveDraft(edited);

      expect(repo.saveDraftCalls, 1);
      expect(repo.savedDraft, same(edited));
      expect(state.draft, same(edited));
    });

    test('decide delegates to repository.decide and removes the inbox item',
        () async {
      final repo = _RecordingRepository();
      final state = AppState(repository: repo);
      await state.loadClaims();
      expect(state.inbox, hasLength(Fixtures.inbox.length));

      await state.decide('EXP-2026-1001', Decision.approve);

      expect(repo.decideCalls, 1);
      expect(repo.lastDecidedId, 'EXP-2026-1001');
      expect(repo.lastDecision, Decision.approve);
      expect(state.inbox.where((item) => item.id == 'EXP-2026-1001'), isEmpty);
      expect(state.inbox, hasLength(Fixtures.inbox.length - 1));
    });

    test('syncNow delegates to repository.sync and clears the queue',
        () async {
      final repo = _RecordingRepository();
      final state = AppState(repository: repo);
      expect(state.pendingQueueCount, Fixtures.queue.length);

      expect(await state.syncNow(), isTrue);

      expect(repo.syncCalls, 1);
      expect(state.synced, isTrue);
      expect(state.lastSyncedCount, Fixtures.queue.length);
      expect(state.pendingQueueCount, 0);
      expect(state.queuedItems, isEmpty);
    });
  });

  group('capture', () {
    test('the multi-page variant stacks pages before it scans', () async {
      final state = AppState(variant: AppVariant.captureMultishot);
      expect(state.shots, 1);

      expect(await state.shoot(), isFalse);
      expect(state.shots, 2);
      expect(await state.shoot(), isFalse);
      expect(state.shots, 3);

      // Third page captured — the next press runs the scan.
      final scan = state.shoot();
      expect(state.scanning, isTrue);
      expect(await scan, isTrue);
      expect(state.scanPercent, 100);
      expect(state.scanStage, ScanStage.done);
    });

    test('the default variant scans on the first press', () async {
      final state = AppState();
      expect(await state.shoot(), isTrue);
      expect(state.shots, 1);
    });

    test('scan copy names the on-device pass when offline', () async {
      final state = AppState(offline: true);
      expect(state.scanSubtitle, contains('Offline'));
    });

    test('captureFromCamera passes bytes to repository.capture and persists',
        () async {
      final repo = _RecordingRepository();
      final store = InMemoryStore();
      final state = await AppState.create(store: store, repository: repo);
      final bytes = Uint8List.fromList(<int>[1, 2, 3]);

      final finished = await state.captureFromCamera(bytes);

      expect(finished, isTrue);
      expect(repo.captureCalls, 1);
      expect(repo.lastCameraBytes, bytes);
      expect(state.draft, same(repo.captureResult));
      final saved = await store.readMap('draft');
      expect(saved, isNotNull);
      expect(saved!['merchant'], 'Kopi Toko Djawa');
      expect(saved['amount'], '24.000');
    });
  });

  group('persistence (#93)', () {
    test('create boots from a pre-populated store (queue + draft + settings)',
        () async {
      final store = InMemoryStore();
      await store.init();
      await store.writeList('queue', <Map<String, dynamic>>[
        const QueueItem(
          id: 'q9',
          title: 'Bench fee',
          meta: 'Taxi · captured offline',
          amount: 25000,
          size: 'JPG 0.1 MB',
        ).toJson(),
      ]);
      await store.writeMap('draft', <String, dynamic>{
        ...Fixtures.initialDraft.toJson(),
        'amount': '120.000',
        'added': true,
      });
      await store.writeString('offline', 'true');
      await store.writeString('variant', 'homeEditorial');

      final state = await AppState.create(store: store);

      expect(state.queuedItems, hasLength(1));
      expect(state.queuedItems.first.title, 'Bench fee');
      expect(state.pendingQueueCount, 1);
      expect(state.draft.amount, '120.000');
      expect(state.added, isTrue);
      expect(state.draftLines, hasLength(3)); // base lines + hydrated line
      expect(state.offline, isTrue);
      expect(state.variant, AppVariant.homeEditorial);
    });

    test('confirmLine persists the updated draft (read back via the store)',
        () async {
      final store = InMemoryStore();
      final state = await AppState.create(store: store);

      state
        ..setField(OcrFieldKey.amount, '150.000')
        ..confirmLine();

      final saved = await store.readMap('draft');
      expect(saved, isNotNull);
      expect(saved!['amount'], '150.000');
      expect(saved['added'], isTrue);
      expect(saved['merchant'], Fixtures.initialDraft.merchant);

      // A relaunch over the same store recovers the confirmed draft.
      final relaunched = await AppState.create(store: store);
      expect(relaunched.added, isTrue);
      expect(relaunched.draft.amount, '150.000');
    });

    test('submitting clears the persisted draft', () async {
      final store = InMemoryStore();
      final state = await AppState.create(store: store);
      state.confirmLine();
      expect(await store.readMap('draft'), isNotNull);

      await state.submit(state.draft);

      expect(await store.readMap('draft'), isNull);
    });

    test('a successful sync clears the persisted queue', () async {
      final store = InMemoryStore();
      final state = await AppState.create(store: store);
      expect(state.pendingQueueCount, Fixtures.queue.length);

      expect(await state.syncNow(), isTrue);

      final persisted = await store.readList('queue');
      expect(persisted, isEmpty);

      // Relaunch over the same store boots "all caught up".
      final relaunched = await AppState.create(store: store);
      expect(relaunched.synced, isTrue);
      expect(relaunched.queuedItems, isEmpty);
      expect(relaunched.queueSummary, 'All caught up — nothing queued');
    });
  });

  group('theme mode (#95)', () {
    test('setThemeMode flips the mode and persists it via the store', () async {
      final store = InMemoryStore();
      final state = await AppState.create(store: store);
      expect(state.themeMode, ThemeMode.system);

      state.setThemeMode(ThemeMode.dark);
      // The write is fire-and-forget (#93); let the chained awaits land.
      await pumpEventQueue();

      expect(state.themeMode, ThemeMode.dark);
      expect(await store.readString('theme_mode'), 'dark');
    });

    test('create hydrates the stored theme mode', () async {
      final store = InMemoryStore();
      await store.init();
      await store.writeString('theme_mode', 'dark');

      final state = await AppState.create(store: store);

      expect(state.themeMode, ThemeMode.dark);
    });

    test('an unknown stored theme mode falls back to system', () async {
      final store = InMemoryStore();
      await store.init();
      await store.writeString('theme_mode', 'neon');

      final state = await AppState.create(store: store);

      expect(state.themeMode, ThemeMode.system);
    });
  });

  group('variant (#96)', () {
    test('the variant setter accepts valid variants in debug', () {
      final state = AppState();
      expect(state.variant, AppVariant.standard);

      state.variant = AppVariant.captureMultishot;

      expect(state.variant, AppVariant.captureMultishot);
    });
  });
}
