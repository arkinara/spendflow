import 'package:flutter/material.dart';

import 'tokens.dart';

/// Inter is the SpendFlow brand face. It is not bundled as an asset — the app
/// asks for it by name and falls back to the platform UI font (Roboto on
/// Android, SF on iOS), which keeps the binary small and the metrics native.
const List<String> kSansFallback = <String>[
  'Inter',
  'Roboto',
  '.SF UI Text',
  'Helvetica Neue',
];

/// Monospace stack for the receipt facsimile and reference codes.
const List<String> kMonoFallback = <String>[
  'Roboto Mono',
  'Menlo',
  'Courier New',
  'monospace',
];

const ColorScheme _lightScheme = ColorScheme(
  brightness: Brightness.light,
  primary: Color(0xFF4539D1),
  onPrimary: Color(0xFFFFFFFF),
  primaryContainer: Color(0xFFDAD6FF),
  onPrimaryContainer: Color(0xFF17114F),
  secondary: Color(0xFF6A5095),
  onSecondary: Color(0xFFFFFFFF),
  secondaryContainer: Color(0xFFE8E1F4),
  onSecondaryContainer: Color(0xFF2A1B45),
  tertiary: Color(0xFF27889B),
  onTertiary: Color(0xFFFFFFFF),
  tertiaryContainer: Color(0xFFD6F0F5),
  onTertiaryContainer: Color(0xFF0B3E48),
  error: Color(0xFFD32222),
  onError: Color(0xFFFFFFFF),
  errorContainer: Color(0xFFFDE3E3),
  onErrorContainer: Color(0xFF6C0F0F),
  surface: Color(0xFFFCFCFD),
  onSurface: Color(0xFF1E1E24),
  onSurfaceVariant: Color(0xFF60606C),
  outline: Color(0xFF9696A6),
  outlineVariant: Color(0xFFD7D7E0),
  inverseSurface: Color(0xFF31313A),
  onInverseSurface: Color(0xFFEFEFF5),
  inversePrimary: Color(0xFFC3BDFF),
  scrim: Color(0xFF1E1E24),
  shadow: Color(0xFF000000),
);

/// M3 dark scheme (#95), mirroring [_lightScheme]'s structure with the
/// brightness flipped and the surface steps tuned for dark backgrounds —
/// lighter "containers" sitting on a darker base, the same inverse-elevation
/// relationship M3 generates from a dark seed.
const ColorScheme _darkScheme = ColorScheme(
  brightness: Brightness.dark,
  primary: Color(0xFFC3BDFF),
  onPrimary: Color(0xFF241F50),
  primaryContainer: Color(0xFF3A34A6),
  onPrimaryContainer: Color(0xFFE6E1FF),
  secondary: Color(0xFFCDBCE6),
  onSecondary: Color(0xFF2C1E44),
  secondaryContainer: Color(0xFF44386A),
  onSecondaryContainer: Color(0xFFE8E1F4),
  tertiary: Color(0xFF8FD5E0),
  onTertiary: Color(0xFF0B3E48),
  tertiaryContainer: Color(0xFF0E4F5A),
  onTertiaryContainer: Color(0xFFD6F0F5),
  error: Color(0xFFF2B8B8),
  onError: Color(0xFF5D1414),
  errorContainer: Color(0xFF8C1D18),
  onErrorContainer: Color(0xFFF9DEDC),
  surface: Color(0xFF14141A),
  onSurface: Color(0xFFE7E7EE),
  onSurfaceVariant: Color(0xFFC2C2CC),
  outline: Color(0xFF8E8E9A),
  outlineVariant: Color(0xFF45454F),
  inverseSurface: Color(0xFFE7E7EE),
  onInverseSurface: Color(0xFF2C2C34),
  inversePrimary: Color(0xFF4539D1),
  scrim: Color(0xFF000000),
  shadow: Color(0xFF000000),
);

/// Build the SpendFlow [ThemeData] for a given [Brightness]. Defaults to
/// light so existing callers and tests keep working unchanged (#95).
ThemeData buildSpendFlowTheme({Brightness brightness = Brightness.light}) {
  final scheme = brightness == Brightness.dark ? _darkScheme : _lightScheme;
  final tokens =
      brightness == Brightness.dark ? SpendFlowTokens.dark : SpendFlowTokens.light;
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: kSansFallback.first,
    fontFamilyFallback: kSansFallback.sublist(1),
  );

  return base.copyWith(
    scaffoldBackgroundColor: scheme.surface,
    extensions: <ThemeExtension<dynamic>>[tokens],
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: tokens.surfaceContainerHigh,
      foregroundColor: scheme.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleMedium?.copyWith(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
        color: scheme.onSurface,
      ),
    ),
    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant,
      thickness: 1,
      space: 1,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        shape: const RoundedRectangleBorder(borderRadius: Radii.pill),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 48),
        foregroundColor: scheme.primary,
        side: BorderSide(color: scheme.outline),
        shape: const RoundedRectangleBorder(borderRadius: Radii.pill),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: scheme.primary,
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: tokens.surfaceContainerHigh,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: Radii.md,
        borderSide: BorderSide(color: scheme.outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: Radii.md,
        borderSide: BorderSide(color: scheme.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: Radii.md,
        borderSide: BorderSide(color: scheme.primary, width: 2),
      ),
      labelStyle: TextStyle(fontSize: 13, color: scheme.onSurfaceVariant),
      helperStyle: TextStyle(fontSize: 10.5, color: scheme.onSurfaceVariant),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: scheme.inverseSurface,
      contentTextStyle: TextStyle(
        fontSize: 12.5,
        height: 1.4,
        color: scheme.onInverseSurface,
      ),
      shape: const RoundedRectangleBorder(borderRadius: Radii.md),
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: tokens.surfaceContainerHigh,
      surfaceTintColor: Colors.transparent,
      indicatorColor: scheme.primary.withValues(alpha: 0.15),
      elevation: 0,
      height: 64,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w500,
          color: selected ? scheme.primary : scheme.onSurfaceVariant,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 21,
          color: selected ? scheme.primary : scheme.onSurfaceVariant,
        );
      }),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
      elevation: 4,
      shape: const RoundedRectangleBorder(borderRadius: Radii.xxl),
    ),
    textTheme: base.textTheme.apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    ),
  );
}
