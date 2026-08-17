import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spendflow_mobile/api/auth.dart';
import 'package:spendflow_mobile/api/http_client.dart';
import 'package:spendflow_mobile/data/fixtures.dart';
import 'package:spendflow_mobile/data/fixtures_claim_repository.dart';
import 'package:spendflow_mobile/data/claim_repository.dart';
import 'package:spendflow_mobile/data/rest_claim_repository.dart';
import 'package:spendflow_mobile/models/models.dart';
import 'package:spendflow_mobile/state/app_state.dart';

Uri _base = Uri.parse('http://be.test');

void main() {
  group('FixturesClaimRepository', () {
    final repo = FixturesClaimRepository();

    test('listClaims delegates to Fixtures.claims', () async {
      final claims = await repo.listClaims('demo-aulia');
      expect(claims, same(Fixtures.claims));
    });

    test('listInbox delegates to Fixtures.inbox', () async {
      final inbox = await repo.listInbox('demo-aulia');
      expect(inbox, same(Fixtures.inbox));
    });

    test('claimById delegates to Fixtures.claimById', () async {
      final claim = await repo.claimById('EXP-2026-1001');
      expect(claim, same(Fixtures.claimById('EXP-2026-1001')));
      expect(await repo.claimById('nope'), isNull);
    });

    test('signIn hands back a demo employee session', () async {
      final user = await repo.signIn(Fixtures.userEmail, 'pw');
      expect(user, isA<AuthUser>());
      expect(user.email, Fixtures.userEmail);
    });

    test('capture hands back the fixtures initialDraft', () async {
      expect(await repo.capture(), same(Fixtures.initialDraft));
    });

    test('saveDraft stores the edited draft and hands it back', () async {
      final edited =
          Fixtures.initialDraft.copyWith(description: 'Edited dinner');
      expect(await repo.saveDraft(edited), same(edited));
      expect(repo.savedDraft, same(edited));
    });

    test('submit returns a SubmissionResult with a non-null claim', () async {
      final result = await repo.submit(Fixtures.initialDraft);

      expect(result.claim, isA<Claim>());
      expect(result.claim.id, Fixtures.draftClaimId);
      expect(result.claim.status, ClaimStatus.pending);
      expect(result.claim.amount, greaterThan(0));
      expect(result.claim.lines.last.source, LineSource.ocr);
      expect(result.status, 'submitted');
    });

    test('sync returns the positive queued count', () async {
      final synced = await repo.sync();

      expect(synced, Fixtures.queue.length);
      expect(synced, greaterThan(0));
    });

    test('decide removes the inbox item at that id', () async {
      await repo.decide('EXP-2026-1001', Decision.approve);

      final inbox = await repo.listInbox('demo-aulia');
      expect(inbox.where((item) => item.id == 'EXP-2026-1001'), isEmpty);
      expect(inbox, hasLength(Fixtures.inbox.length - 1));
      expect(inbox.first.id, 'EXP-2026-1005');
    });
  });

  group('RestClaimRepository', () {
    test('listClaims GETs /api/claims scoped by employee_id and decodes',
        () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response(
          '{"claims":[{"id":"c1","code":"EXP-1","title":"Taxi","place":"Jakarta",'
          '"status":"pending","amount":150000,"dateLabel":"21 Jul",'
          '"itemCount":1,"receiptCount":1,"headline":"","slaLabel":null,'
          '"lines":[],"timeline":[]}]}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      final claims = await repo.listClaims('emp-42');

      expect(calls, hasLength(1));
      expect(calls.single.method, 'GET');
      expect(calls.single.url.path, '/api/claims');
      expect(calls.single.url.queryParameters['employee_id'], 'emp-42');
      expect(claims, hasLength(1));
      expect(claims.single.id, 'c1');
      expect(claims.single.title, 'Taxi');
      expect(claims.single.amount, 150000);
    });

    test('signIn POSTs credentials then reads the session back via /api/me',
        () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        if (request.url.path == '/api/auth/sign-in/email') {
          return http.Response('{}', 200);
        }
        return http.Response(
          '{"user":{"id":"u1","email":"a@b.c","name":"A B","role":"employee"}}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      final user = await repo.signIn('a@b.c', 'pw');

      expect(calls, hasLength(2));
      expect(calls.first.method, 'POST');
      expect(calls.first.url.path, '/api/auth/sign-in/email');
      expect(calls.last.url.path, '/api/me');
      expect(user.email, 'a@b.c');
    });

    test('capture POSTs /api/mobile/capture and decodes the draft', () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response(
          '{"merchant":"Warung Sederhana","date":"15/07/2026",'
          '"amount":"391.830","tax":"38.830","currency":"IDR",'
          '"category":"Meals","description":"Team dinner with PT Nusantara"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      final draft = await repo.capture();

      expect(calls, hasLength(1));
      expect(calls.single.method, 'POST');
      expect(calls.single.url.path, '/api/mobile/capture');
      expect(draft.merchant, 'Warung Sederhana');
      expect(draft.amount, '391.830');
      expect(draft.category, 'Meals');
    });

    test('saveDraft PATCHes /api/mobile/drafts/current with the draft body',
        () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response(
          '{"merchant":"Warung Sederhana","date":"15/07/2026",'
          '"amount":"391.830","tax":"38.830","currency":"IDR",'
          '"category":"Meals","description":"Stored on the server"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      final saved = await repo.saveDraft(Fixtures.initialDraft);

      expect(calls, hasLength(1));
      expect(calls.single.method, 'PATCH');
      expect(calls.single.url.path, '/api/mobile/drafts/current');
      final sent = jsonDecode(calls.single.body) as Map<String, dynamic>;
      expect(sent['merchant'], 'Warung Sederhana');
      expect(sent['amount'], '391.830');
      expect(sent['description'], 'Team dinner with PT Nusantara');
      expect(saved.description, 'Stored on the server');
    });

    test('submit POSTs /api/mobile/claims and decodes the stored claim',
        () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response(
          '{"claim":{"id":"c9","code":"Q3","title":"Q3 · Client Visit",'
          '"place":"Jakarta","status":"pending","amount":391830,'
          '"dateLabel":"28 Jul","itemCount":3,"receiptCount":3,'
          '"headline":"submitted 28 Jul 2026","slaLabel":"SLA 2 days left",'
          '"lines":[],"timeline":[]},"status":"submitted"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      final result = await repo.submit(Fixtures.initialDraft);

      expect(calls, hasLength(1));
      expect(calls.single.method, 'POST');
      expect(calls.single.url.path, '/api/mobile/claims');
      final sent = jsonDecode(calls.single.body) as Map<String, dynamic>;
      expect(sent['merchant'], 'Warung Sederhana');
      expect(sent['amount'], '391.830');
      expect(result.claim.id, 'c9');
      expect(result.claim.amount, 391830);
      expect(result.status, 'submitted');
    });

    test('sync POSTs /api/mobile/sync and returns the synced count', () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response('{"synced":3}', 200,
            headers: {'content-type': 'application/json'});
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      final synced = await repo.sync();

      expect(calls, hasLength(1));
      expect(calls.single.method, 'POST');
      expect(calls.single.url.path, '/api/mobile/sync');
      expect(synced, 3);
    });

    test('decide POSTs the decision to the inbox item endpoint', () async {
      final calls = <http.Request>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response('{}', 200,
            headers: {'content-type': 'application/json'});
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
      );

      await repo.decide('EXP-2026-1001', Decision.approve);

      expect(calls, hasLength(1));
      expect(calls.single.method, 'POST');
      expect(calls.single.url.path, '/api/mobile/inbox/EXP-2026-1001/decide');
      final sent = jsonDecode(calls.single.body) as Map<String, dynamic>;
      expect(sent['decision'], 'approve');
    });
  });

  group('AppState regression', () {
    test('an AppState on FixturesClaimRepository keeps the old inbox', () {
      final plain = AppState();
      final injected = AppState(repository: FixturesClaimRepository());

      expect(injected.homeClaims, hasLength(Fixtures.claims.length + 1));
      // The inbox getter copies via `skip().toList()`, so compare contents.
      expect(
        injected.inbox.map((item) => item.submitter),
        plain.inbox.map((item) => item.submitter),
      );
      expect(injected.inbox, hasLength(plain.inbox.length));
    });
  });
}
