import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/api/auth.dart';
import 'package:spendflow_mobile/data/claim_repository.dart';
import 'package:spendflow_mobile/data/fixtures.dart';
import 'package:spendflow_mobile/data/fixtures_claim_repository.dart';
import 'package:spendflow_mobile/models/models.dart';
import 'package:spendflow_mobile/state/app_state.dart';

/// Records every call so an injected [AppState] can be proven to read its
/// claims through the repository rather than straight from [Fixtures].
class _RecordingRepository implements ClaimRepository {
  int listClaimsCalls = 0;

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
      const <InboxItem>[];
}

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
    test('deciding consumes the item from the top', () {
      final state = AppState();
      expect(state.inbox, hasLength(Fixtures.inbox.length));

      state.decide();

      expect(state.inbox, hasLength(Fixtures.inbox.length - 1));
      expect(state.inbox.first.submitter, 'Bima Nugroho');
    });
  });

  group('repository injection', () {
    test('the default repository is the fixtures demo implementation', () {
      expect(AppState().repository, isA<FixturesClaimRepository>());
    });

    test('loadClaims reads claims through the injected repository', () async {
      final repo = _RecordingRepository();
      final state = AppState(repository: repo);

      expect(state.homeClaims, hasLength(1)); // draft only, repo still empty

      await state.loadClaims();

      expect(repo.listClaimsCalls, 1);
      expect(state.homeClaims, hasLength(1));
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
  });
}
