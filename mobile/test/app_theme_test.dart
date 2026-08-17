import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/theme/app_theme.dart';
import 'package:spendflow_mobile/theme/tokens.dart';

/// Every color slot the light token set defines, so the dark set can be proven
/// to carry a counterpart for each rather than falling back by omission.
final List<Color Function(SpendFlowTokens)> _tokenFields = <
    Color Function(SpendFlowTokens)>[
  (t) => t.success,
  (t) => t.successContainer,
  (t) => t.onSuccessContainer,
  (t) => t.warning,
  (t) => t.warningContainer,
  (t) => t.onWarningContainer,
  (t) => t.info,
  (t) => t.infoContainer,
  (t) => t.onInfoContainer,
  (t) => t.surfaceContainerLowest,
  (t) => t.surfaceContainerLow,
  (t) => t.surfaceContainer,
  (t) => t.surfaceContainerHigh,
  (t) => t.receiptPaper,
];

void main() {
  test('dark theme resolves to a dark scheme', () {
    expect(
      buildSpendFlowTheme(brightness: Brightness.dark)
          .colorScheme
          .brightness,
      Brightness.dark,
    );
  });

  test('light theme resolves to a light scheme', () {
    expect(
      buildSpendFlowTheme(brightness: Brightness.light)
          .colorScheme
          .brightness,
      Brightness.light,
    );
  });

  test('the no-arg builder keeps the light default (#95 compatibility)', () {
    expect(buildSpendFlowTheme().colorScheme.brightness, Brightness.light);
  });

  test('dark tokens define a counterpart for every light entry', () {
    const light = SpendFlowTokens.light;
    const dark = SpendFlowTokens.dark;
    for (final field in _tokenFields) {
      expect(field(dark), isNot(field(light)),
          reason: 'dark ${field(light)} must not fall back to the light value');
    }
  });

  test('dark surface containers follow M3 inverse-elevation ordering', () {
    double luminance(Color c) => c.computeLuminance();
    const dark = SpendFlowTokens.dark;
    expect(luminance(dark.surfaceContainerLowest),
        lessThan(luminance(dark.surfaceContainerLow)));
    expect(luminance(dark.surfaceContainerLow),
        lessThan(luminance(dark.surfaceContainer)));
    expect(luminance(dark.surfaceContainer),
        lessThan(luminance(dark.surfaceContainerHigh)));
  });

  test('tokens lerp a midpoint between light and dark schemes', () {
    final mid = SpendFlowTokens.light.lerp(SpendFlowTokens.dark, 0.5);
    final lightSurface = SpendFlowTokens.light.surfaceContainer;
    final darkSurface = SpendFlowTokens.dark.surfaceContainer;

    // The midpoint sits strictly between the two endpoints — a perceptually
    // plausible transition rather than snapping to either side.
    expect(mid.surfaceContainer, isNot(lightSurface));
    expect(mid.surfaceContainer, isNot(darkSurface));
    expect(mid.surfaceContainer.computeLuminance(),
        lessThan(lightSurface.computeLuminance()));
    expect(mid.surfaceContainer.computeLuminance(),
        greaterThan(darkSurface.computeLuminance()));
  });
}
