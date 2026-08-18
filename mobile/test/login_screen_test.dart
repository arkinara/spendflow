import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/api/auth.dart';
import 'package:spendflow_mobile/api/errors.dart';
import 'package:spendflow_mobile/app.dart';
import 'package:spendflow_mobile/data/claim_repository.dart';
import 'package:spendflow_mobile/data/fixtures.dart';
import 'package:spendflow_mobile/models/models.dart';

/// A repository the login screen drives through: records the submitted
/// credentials and either hands back a fixed user, throws, or waits on a
/// [Completer] the test controls (for the in-flight state).
class _FakeRepository implements ClaimRepository {
  AuthUser? signInResult;
  ApiException? signInError;
  Completer<AuthUser>? gate;
  int signInCalls = 0;
  String? lastEmail;
  String? lastPassword;

  @override
  Future<AuthUser> signIn(String email, String password) {
    signInCalls += 1;
    lastEmail = email;
    lastPassword = password;
    if (signInError != null) return Future<AuthUser>.error(signInError!);
    final pending = gate;
    if (pending != null) return pending.future;
    return Future<AuthUser>.value(
      signInResult ??
          AuthUser(id: 'u1', email: email, name: 'Tester', role: 'employee'),
    );
  }

  @override
  Future<AuthUser?> getCurrentUser() async => null;

  @override
  Future<void> signOut() async {}

  @override
  Future<List<Claim>> listClaims(String employeeId) async => const <Claim>[];

  @override
  Future<Claim?> claimById(String claimId) async => null;

  @override
  Future<List<InboxItem>> listInbox(String approverId) async =>
      const <InboxItem>[];

  @override
  Future<OcrDraft> capture({Uint8List? cameraBytes}) async => Fixtures.initialDraft;

  @override
  Future<OcrDraft> saveDraft(OcrDraft draft) async => draft;

  @override
  Future<SubmissionResult> submit(OcrDraft draft) async =>
      SubmissionResult(claim: _claim());

  @override
  Future<int> sync() async => 0;

  @override
  Future<void> decide(String inboxItemId, Decision decision) async {}

  Claim _claim() => Claim(
        id: 'c1',
        code: 'Q3',
        title: 'Q3 Client Visit',
        place: 'Jakarta',
        status: ClaimStatus.pending,
        amount: 100,
        dateLabel: '28 Jul',
        itemCount: 1,
        receiptCount: 0,
        headline: '',
        slaLabel: null,
        lines: const <ClaimLine>[],
        timeline: const <TimelineEntry>[],
      );
}

Future<void> _pump(WidgetTester tester, _FakeRepository repo) async {
  await tester.pumpWidget(SpendFlowApp(initialRepository: repo));
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(find.text('Sign in'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('empty email + password shows inline validation, no API call',
      (tester) async {
    final repo = _FakeRepository();
    await _pump(tester, repo);

    await _submit(tester);

    expect(find.text('Enter your work email'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
    expect(repo.signInCalls, 0);
    // Still on the login screen.
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('valid credentials call signIn and land on the shell',
      (tester) async {
    final repo = _FakeRepository();
    await _pump(tester, repo);

    await tester.enterText(
        find.byType(TextFormField).first, ' aulia@spendflow.example ');
    await tester.enterText(find.byType(TextFormField).at(1), 'pw');
    await _submit(tester);

    expect(repo.signInCalls, 1);
    expect(repo.lastEmail, 'aulia@spendflow.example'); // trimmed
    expect(repo.lastPassword, 'pw');
    // Navigated to MainShell — the draft claim is the home screen's head row.
    expect(find.text('Q3 Client Visit – Jakarta'), findsOneWidget);
    expect(find.text('Sign in'), findsNothing);
  });

  testWidgets('an ApiException toasts the message and stays on the screen',
      (tester) async {
    final repo = _FakeRepository()
      ..signInError = const ApiError(
        status: 401,
        code: 'INVALID_EMAIL_OR_PASSWORD',
        message: 'Invalid email or password',
      );
    await _pump(tester, repo);

    await tester.enterText(find.byType(TextFormField).first, 'a@b.c');
    await tester.enterText(find.byType(TextFormField).at(1), 'wrong');
    await _submit(tester);

    expect(repo.signInCalls, 1);
    expect(find.text('Invalid email or password'), findsOneWidget);
    // Stayed put: the login form is still the current screen.
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Q3 Client Visit – Jakarta'), findsNothing);
    // Email kept for the retry; only the password cleared (negative AC #102).
    expect(find.text('a@b.c'), findsOneWidget);
  });

  testWidgets('a spinner shows while the sign-in request is in flight',
      (tester) async {
    final repo = _FakeRepository()..gate = Completer<AuthUser>();
    await _pump(tester, repo);

    await tester.enterText(find.byType(TextFormField).first, 'a@b.c');
    await tester.enterText(find.byType(TextFormField).at(1), 'pw');
    await tester.tap(find.text('Sign in'));
    await tester.pump();

    // In flight: spinner up, button disabled (no double-submit).
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(
      tester.widget<ElevatedButton>(find.byType(ElevatedButton)).onPressed,
      isNull,
    );

    repo.gate!.complete(
      AuthUser(id: 'u1', email: 'a@b.c', name: 'Tester', role: 'employee'),
    );
    await tester.pumpAndSettle();

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Q3 Client Visit – Jakarta'), findsOneWidget);
  });
}
