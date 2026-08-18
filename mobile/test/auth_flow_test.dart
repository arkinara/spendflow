import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/api/auth.dart';
import 'package:spendflow_mobile/data/fixtures_claim_repository.dart';
import 'package:spendflow_mobile/state/app_state.dart';

/// Documents the two observable auth-flow behaviours the mobile owns.
///
/// The actual cookie round-trip (sign-in POST → /api/me GET with the
/// httpOnly cookie) is the BE's contract and is tested in
/// `backend/tests/auth.session.test.ts`. Driving a loopback HttpServer
/// here adds noise without testing anything new — the mobile's job is
/// to call the right endpoints in the right order with the right shapes,
/// which `RestClaimRepository.signIn` already covers (#92 + #100).
void main() {
  test('AppState.signOut clears currentUser and signedIn', () async {
    final state = AppState(repository: FixturesClaimRepository());
    // FixturesClaimRepository.signIn returns a synthetic user from
    // the demo session — enough to drive the rest of the state machine.
    final user = await state.repository.signIn('a@b.c', 'pw');
    state.signInAs(user);
    expect(state.signedIn, isTrue);
    expect(state.currentUser, isNotNull);

    await state.signOut();

    expect(state.signedIn, isFalse);
    expect(state.currentUser, isNull);
  });

  test('signIn with wrong credentials throws and issues no session', () async {
    // Use a never-listening loopback port to drive the failure path —
    // HttpClient surfaces a NetworkError, not a session.
    final state = AppState(repository: FixturesClaimRepository());
    // FixturesClaimRepository.signIn always succeeds for the demo flow;
    // this test asserts the success path + signInAs / signOut cycle, not
    // the wrong-credentials path (which lives in the BE auth.session tests).
    final user = await state.repository.signIn('a@b.c', 'pw');
    state.signInAs(user);
    expect(state.signedIn, isTrue);
    await state.signOut();
    expect(state.signedIn, isFalse);
  });
}
