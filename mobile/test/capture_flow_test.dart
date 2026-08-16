import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/app.dart';
import 'package:spendflow_mobile/state/app_state.dart';

/// Drives the scan timer to completion. The OCR pass ticks every 190ms, so a
/// dozen 200ms pumps covers it with room to spare.
Future<void> _runScan(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 200));
  }
  await tester.pumpAndSettle();
}

Future<void> _signIn(WidgetTester tester, {AppState? state}) async {
  await tester.pumpWidget(SpendFlowApp(initialState: state ?? AppState()));
  await tester.tap(find.text('Sign in'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('sign-in lands on the employee home', (tester) async {
    await _signIn(tester);

    expect(find.text('Aulia Pratiwi'), findsOneWidget);
    expect(find.textContaining('approver Dewi Anggraeni'), findsOneWidget);
    expect(find.text('Q2 Client Visit – Jakarta'), findsOneWidget);
  });

  testWidgets('capture → scan → confirm → add puts the line on the draft',
      (tester) async {
    await _signIn(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    expect(find.text('Position the receipt'), findsOneWidget);

    await tester.tap(find.bySemanticsLabel('Capture receipt'));
    await _runScan(tester);

    // Nothing is submitted from raw OCR — the confirmation screen is the gate.
    expect(find.text('Confirm extraction'), findsOneWidget);
    expect(find.text('Nothing is submitted until you confirm'), findsOneWidget);
    expect(find.text('SCANNED'), findsWidgets);

    // The low-confidence tax field asks to be checked, and the scanned meal
    // declares its cap breach before it ever lands on the claim.
    // The confirm list is one of several scrollables on screen (each text
    // field carries its own), so target the outer one explicitly.
    final confirmList = find.byType(Scrollable).first;
    await tester.scrollUntilVisible(
      find.text('CHECK THIS'),
      200,
      scrollable: confirmList,
    );
    expect(find.text('CHECK THIS'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('Meals cap is Rp 350.000'),
      200,
      scrollable: confirmList,
    );
    expect(find.textContaining('Rp 41.830 over'), findsOneWidget);

    await tester.tap(find.text('Confirm & add'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Line items'), findsOneWidget);
    expect(find.text('Team dinner with PT Nusantara'), findsOneWidget);
    expect(find.textContaining('routes to Finance exception review'),
        findsOneWidget);
    expect(find.text('Rp 4.641.830'), findsWidgets);

    // The claim total picked up the new line, and the flag is surfaced in the
    // summary rather than only on the row.
    await tester.scrollUntilVisible(find.text('Policy flags'), 200);
    expect(find.text('1 to review'), findsOneWidget);
  });

  testWidgets('retake goes back to the viewfinder, not out of the flow',
      (tester) async {
    await _signIn(tester);

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Capture receipt'));
    await _runScan(tester);
    expect(find.text('Confirm extraction'), findsOneWidget);

    await tester.tap(find.text('Retake'));
    await tester.pumpAndSettle();

    expect(find.text('Position the receipt'), findsOneWidget);
  });

  testWidgets('the capture FAB yields to Sync on the queue tab',
      (tester) async {
    await _signIn(tester);
    expect(find.byType(FloatingActionButton), findsOneWidget);

    await tester.tap(find.text('Queue'));
    await tester.pumpAndSettle();

    expect(find.byType(FloatingActionButton), findsNothing);
    expect(find.text('Sync 3 items now'), findsOneWidget);
  });

  testWidgets('submitting online reaches the approver', (tester) async {
    final state = AppState()..confirmLine();
    await _signIn(tester, state: state);

    await tester.tap(find.text('Q3 Client Visit – Jakarta'));
    await tester.pumpAndSettle();

    expect(find.text('Submit claim'), findsOneWidget);
    await tester.tap(find.text('Submit claim'));
    await tester.pumpAndSettle();

    expect(find.text('Submitted for approval'), findsOneWidget);
    expect(find.text('EXP-2026-1013'), findsOneWidget);
    expect(find.text('Dewi Anggraeni'), findsOneWidget);
  });

  testWidgets('submitting offline reroutes to the queue', (tester) async {
    final state = AppState(offline: true)..confirmLine();
    await _signIn(tester, state: state);

    // The banner names the state before the user hits a dead end.
    expect(find.text("You're offline — capture still works"), findsOneWidget);

    await tester.tap(find.text('Q3 Client Visit – Jakarta'));
    await tester.pumpAndSettle();

    expect(find.text('Queue for submission'), findsOneWidget);
    await tester.tap(find.text('Queue for submission'));
    await tester.pumpAndSettle();

    expect(find.text('Sync queue'), findsOneWidget);
    expect(find.text('No connection'), findsOneWidget);
    expect(find.text('Waiting for network'), findsWidgets);
    expect(state.submitted, isFalse);
  });

  testWidgets('the quiet variant drops the offline banner', (tester) async {
    final state = AppState(offline: true, variant: AppVariant.syncQuiet);
    await _signIn(tester, state: state);

    expect(find.text("You're offline — capture still works"), findsNothing);
    // The queue badge still carries the count.
    expect(find.byType(Badge), findsWidgets);
  });

  testWidgets('the queue syncs and reports it', (tester) async {
    await _signIn(tester);

    await tester.tap(find.text('Queue'));
    await tester.pumpAndSettle();

    expect(find.text('Sync 3 items now'), findsOneWidget);
    expect(find.text('Waiting for network'), findsNWidgets(3));

    await tester.tap(find.text('Sync 3 items now'));
    await tester.pump();
    expect(find.text('Syncing…'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 1500));
    await tester.pumpAndSettle();

    expect(find.text('All synced'), findsOneWidget);
    expect(find.text('Everything is synced'), findsOneWidget);
    expect(find.text('Synced'), findsNWidgets(3));
  });

  testWidgets('an approver can decide from the inbox list', (tester) async {
    await _signIn(tester);

    await tester.tap(find.text('Approvals'));
    await tester.pumpAndSettle();

    expect(find.text('3 waiting'), findsOneWidget);
    expect(find.text('Overdue'), findsOneWidget);
    expect(find.textContaining('over the meals cap'), findsOneWidget);

    await tester.tap(find.text('Approve').first);
    await tester.pumpAndSettle();

    expect(find.text('2 waiting'), findsOneWidget);
  });

  testWidgets('claim detail shows the audit trail and every line',
      (tester) async {
    await _signIn(tester);

    await tester.tap(find.text('Q2 Client Visit – Jakarta'));
    await tester.pumpAndSettle();

    expect(find.text('Rp 4.787.000'), findsWidgets);
    expect(find.text('Status'), findsOneWidget);
    expect(find.text('Awaiting Dewi Anggraeni'), findsOneWidget);
    expect(find.text('Finance payment run'), findsOneWidget);
    expect(find.text('Return flight CGK ⇄ SUB'), findsOneWidget);
    expect(find.text('Personal car to airport'), findsOneWidget);
  });
}
