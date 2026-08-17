import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/state/app_state.dart';
import 'package:spendflow_mobile/util/debug_menu.dart';

void main() {
  test('kDebugMenu is true in the test environment', () {
    // flutter_test runs in non-product mode, so the debug flag is live.
    expect(kDebugMenu, isTrue);
    expect(debugMenuEnabled, isTrue);
  });

  test('the variant setter is a no-op when the debug menu is off', () {
    final previous = debugMenuEnabled;
    debugMenuEnabled = false;
    try {
      final state = AppState();
      expect(state.variant, AppVariant.standard);

      state.variant = AppVariant.captureMultishot;

      expect(state.variant, AppVariant.standard);
    } finally {
      debugMenuEnabled = previous;
    }
  });

  test('a non-standard injected variant is clamped when the debug menu is off',
      () {
    final previous = debugMenuEnabled;
    debugMenuEnabled = false;
    try {
      final state = AppState(variant: AppVariant.homeEditorial);

      expect(state.variant, AppVariant.standard);
    } finally {
      debugMenuEnabled = previous;
    }
  });

  test('the default AppState.variant is AppVariant.standard', () {
    expect(AppState().variant, AppVariant.standard);
  });
}
