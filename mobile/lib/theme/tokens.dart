import 'package:flutter/material.dart';

/// Material 3 token set for SpendFlow mobile.
///
/// The values are the same ones the Phase 1 web app carries in
/// `frontend/app/globals.css`, so a claim card reads identically on either
/// surface. Semantic roles that M3's [ColorScheme] has no slot for (success /
/// warning / info, and the extra surface-container steps) live here.
class SpendFlowTokens extends ThemeExtension<SpendFlowTokens> {
  const SpendFlowTokens({
    required this.success,
    required this.successContainer,
    required this.onSuccessContainer,
    required this.warning,
    required this.warningContainer,
    required this.onWarningContainer,
    required this.info,
    required this.infoContainer,
    required this.onInfoContainer,
    required this.surfaceContainerLowest,
    required this.surfaceContainerLow,
    required this.surfaceContainer,
    required this.surfaceContainerHigh,
    required this.receiptPaper,
  });

  final Color success;
  final Color successContainer;
  final Color onSuccessContainer;

  final Color warning;
  final Color warningContainer;
  final Color onWarningContainer;

  final Color info;
  final Color infoContainer;
  final Color onInfoContainer;

  final Color surfaceContainerLowest;
  final Color surfaceContainerLow;
  final Color surfaceContainer;
  final Color surfaceContainerHigh;

  /// Paper stock the scanned receipt is drawn on.
  final Color receiptPaper;

  static const SpendFlowTokens light = SpendFlowTokens(
    success: Color(0xFF218C57),
    successContainer: Color(0xFFD7F4E6),
    onSuccessContainer: Color(0xFF0C4529),
    warning: Color(0xFFCE7B09),
    warningContainer: Color(0xFFFCEDCF),
    onWarningContainer: Color(0xFF532E09),
    info: Color(0xFF1C6FE3),
    infoContainer: Color(0xFFDEEBFC),
    onInfoContainer: Color(0xFF11325F),
    surfaceContainerLowest: Color(0xFFFFFFFF),
    surfaceContainerLow: Color(0xFFF5F5F9),
    surfaceContainer: Color(0xFFEFEFF5),
    surfaceContainerHigh: Color(0xFFE7E7EF),
    receiptPaper: Color(0xFFF6F4EF),
  );

  /// Convenience accessor — every screen reads tokens off the theme.
  static SpendFlowTokens of(BuildContext context) =>
      Theme.of(context).extension<SpendFlowTokens>() ?? light;

  @override
  SpendFlowTokens copyWith({
    Color? success,
    Color? successContainer,
    Color? onSuccessContainer,
    Color? warning,
    Color? warningContainer,
    Color? onWarningContainer,
    Color? info,
    Color? infoContainer,
    Color? onInfoContainer,
    Color? surfaceContainerLowest,
    Color? surfaceContainerLow,
    Color? surfaceContainer,
    Color? surfaceContainerHigh,
    Color? receiptPaper,
  }) {
    return SpendFlowTokens(
      success: success ?? this.success,
      successContainer: successContainer ?? this.successContainer,
      onSuccessContainer: onSuccessContainer ?? this.onSuccessContainer,
      warning: warning ?? this.warning,
      warningContainer: warningContainer ?? this.warningContainer,
      onWarningContainer: onWarningContainer ?? this.onWarningContainer,
      info: info ?? this.info,
      infoContainer: infoContainer ?? this.infoContainer,
      onInfoContainer: onInfoContainer ?? this.onInfoContainer,
      surfaceContainerLowest:
          surfaceContainerLowest ?? this.surfaceContainerLowest,
      surfaceContainerLow: surfaceContainerLow ?? this.surfaceContainerLow,
      surfaceContainer: surfaceContainer ?? this.surfaceContainer,
      surfaceContainerHigh: surfaceContainerHigh ?? this.surfaceContainerHigh,
      receiptPaper: receiptPaper ?? this.receiptPaper,
    );
  }

  @override
  SpendFlowTokens lerp(covariant SpendFlowTokens? other, double t) {
    if (other == null) return this;
    return SpendFlowTokens(
      success: Color.lerp(success, other.success, t)!,
      successContainer: Color.lerp(successContainer, other.successContainer, t)!,
      onSuccessContainer:
          Color.lerp(onSuccessContainer, other.onSuccessContainer, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningContainer: Color.lerp(warningContainer, other.warningContainer, t)!,
      onWarningContainer:
          Color.lerp(onWarningContainer, other.onWarningContainer, t)!,
      info: Color.lerp(info, other.info, t)!,
      infoContainer: Color.lerp(infoContainer, other.infoContainer, t)!,
      onInfoContainer: Color.lerp(onInfoContainer, other.onInfoContainer, t)!,
      surfaceContainerLowest:
          Color.lerp(surfaceContainerLowest, other.surfaceContainerLowest, t)!,
      surfaceContainerLow:
          Color.lerp(surfaceContainerLow, other.surfaceContainerLow, t)!,
      surfaceContainer: Color.lerp(surfaceContainer, other.surfaceContainer, t)!,
      surfaceContainerHigh:
          Color.lerp(surfaceContainerHigh, other.surfaceContainerHigh, t)!,
      receiptPaper: Color.lerp(receiptPaper, other.receiptPaper, t)!,
    );
  }
}

/// Corner radii used across the app — 12 for controls, 14/16 for cards,
/// 20 for the editorial slab, 999 for M3 pill buttons and chips.
class Radii {
  const Radii._();

  static const BorderRadius sm = BorderRadius.all(Radius.circular(9));
  static const BorderRadius md = BorderRadius.all(Radius.circular(12));
  static const BorderRadius lg = BorderRadius.all(Radius.circular(14));
  static const BorderRadius xl = BorderRadius.all(Radius.circular(16));
  static const BorderRadius xxl = BorderRadius.all(Radius.circular(20));
  static const BorderRadius pill = BorderRadius.all(Radius.circular(999));
}
