import 'package:flutter/material.dart';

import '../data/fixtures.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import 'shell.dart';

/// Sign-in.
///
/// Credentials are pre-filled and the button is a straight hand-off: there is
/// no auth backend on mobile yet, and the screen exists so the flow starts
/// where it will start in production.
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  static const String routeName = '/';

  void _signIn(BuildContext context) {
    AppScope.read(context).signIn();
    Navigator.of(context).pushReplacementNamed(MainShell.routeName);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary,
                    borderRadius: Radii.xl,
                  ),
                  child: Icon(
                    Icons.receipt_long,
                    size: 26,
                    color: theme.colorScheme.onPrimary,
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  'SpendFlow',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Snap a receipt, we read it, you confirm. Works offline.',
                  style: TextStyle(
                    fontSize: 14,
                    height: 1.5,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 28),
                const _ReadOnlyField(
                  label: 'Work email',
                  value: Fixtures.userEmail,
                ),
                const SizedBox(height: 14),
                const _ReadOnlyField(
                  label: 'Password',
                  value: '••••••••••',
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () => _signIn(context),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 52)),
                  child: const Text('Sign in'),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () => _signIn(context),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 52),
                  ),
                  icon: const Icon(Icons.lock_outline, size: 18),
                  label: const Text('Continue with SSO'),
                ),
                const SizedBox(height: 24),
                Text(
                  'Offline capture stays available after sign-in — drafts sync '
                  'when you reconnect.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.6,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReadOnlyField extends StatelessWidget {
  const _ReadOnlyField({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 6),
        Container(
          height: 48,
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: SpendFlowTokens.of(context).surfaceContainerHigh,
            borderRadius: Radii.md,
            border: Border.all(color: theme.colorScheme.outline),
          ),
          child: Text(value, style: const TextStyle(fontSize: 14)),
        ),
      ],
    );
  }
}
