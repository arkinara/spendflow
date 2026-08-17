import 'package:flutter/material.dart';

import '../state/app_state.dart';

// RadioGroup — the groupValue/onChanged replacement the deprecation points at —
// is not shipped in this Flutter build yet, so the classic RadioListTile API
// stays in use here. Revisit once the replacement lands.
// ignore_for_file: deprecated_member_use

/// Minimal Settings screen (#95) — one Appearance section hosting the
/// theme-mode toggle. Deliberately small: account, logout, version info and
/// the rest arrive as separate tickets.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  static const String routeName = '/settings';

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              'Appearance',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.4,
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
          RadioListTile<ThemeMode>(
            title: const Text('Match system'),
            subtitle: const Text("Theme follows the phone's light/dark setting"),
            value: ThemeMode.system,
            groupValue: state.themeMode,
            onChanged: (value) {
              if (value != null) state.setThemeMode(value);
            },
          ),
          RadioListTile<ThemeMode>(
            title: const Text('Light'),
            value: ThemeMode.light,
            groupValue: state.themeMode,
            onChanged: (value) {
              if (value != null) state.setThemeMode(value);
            },
          ),
          RadioListTile<ThemeMode>(
            title: const Text('Dark'),
            value: ThemeMode.dark,
            groupValue: state.themeMode,
            onChanged: (value) {
              if (value != null) state.setThemeMode(value);
            },
          ),
        ],
      ),
    );
  }
}
