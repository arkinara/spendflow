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

ThemeData buildSpendFlowTheme() {
  const tokens = SpendFlowTokens.light;
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: _lightScheme,
    fontFamily: kSansFallback.first,
    fontFamilyFallback: kSansFallback.sublist(1),
  );

  return base.copyWith(
    scaffoldBackgroundColor: _lightScheme.surface,
    extensions: const <ThemeExtension<dynamic>>[tokens],
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
      backgroundColor: tokens.surfaceContainerHigh,
      foregroundColor: _lightScheme.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleMedium?.copyWith(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
        color: _lightScheme.onSurface,
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: Color(0xFFD7D7E0),
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
        foregroundColor: _lightScheme.primary,
        side: const BorderSide(color: Color(0xFF9696A6)),
        shape: const RoundedRectangleBorder(borderRadius: Radii.pill),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: _lightScheme.primary,
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: tokens.surfaceContainerHigh,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: const OutlineInputBorder(
        borderRadius: Radii.md,
        borderSide: BorderSide(color: Color(0xFF9696A6)),
      ),
      enabledBorder: const OutlineInputBorder(
        borderRadius: Radii.md,
        borderSide: BorderSide(color: Color(0xFF9696A6)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: Radii.md,
        borderSide: BorderSide(color: _lightScheme.primary, width: 2),
      ),
      labelStyle: const TextStyle(fontSize: 13, color: Color(0xFF60606C)),
      helperStyle: const TextStyle(fontSize: 10.5, color: Color(0xFF60606C)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: _lightScheme.inverseSurface,
      contentTextStyle: TextStyle(
        fontSize: 12.5,
        height: 1.4,
        color: _lightScheme.onInverseSurface,
      ),
      shape: const RoundedRectangleBorder(borderRadius: Radii.md),
      insetPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: _lightScheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: tokens.surfaceContainerHigh,
      surfaceTintColor: Colors.transparent,
      indicatorColor: _lightScheme.primary.withValues(alpha: 0.15),
      elevation: 0,
      height: 64,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w500,
          color: selected ? _lightScheme.primary : _lightScheme.onSurfaceVariant,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 21,
          color: selected ? _lightScheme.primary : _lightScheme.onSurfaceVariant,
        );
      }),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: _lightScheme.primary,
      foregroundColor: _lightScheme.onPrimary,
      elevation: 4,
      shape: const RoundedRectangleBorder(borderRadius: Radii.xxl),
    ),
    textTheme: base.textTheme.apply(
      bodyColor: _lightScheme.onSurface,
      displayColor: _lightScheme.onSurface,
    ),
  );
}
