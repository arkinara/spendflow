import 'package:flutter/material.dart';

import '../api/errors.dart';
import '../state/app_state.dart';
import '../theme/tokens.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// Sign-in.
///
/// Real email + password form against the repository seam (#91) — the REST
/// repository POSTs to `/api/auth/sign-in/email` and reads the session back
/// from `/api/me`; the fixtures repository accepts anything and returns the
/// demo employee. Errors surface as a toast and the screen stays put — no
/// silent fallback to demo credentials.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  static const String routeName = '/';

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Validate, then exchange the credentials for a session. On success the
  /// [AppState] is seeded with the returned user and the shell takes over; on
  /// [ApiException] (bad credentials, offline, …) the message is toasted and
  /// the screen stays put. The email is preserved so a retry never retypes it;
  /// only the password resets.
  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _submitting = true);
    final state = AppScope.read(context);
    try {
      final user =
          await state.repository.signIn(_email.text.trim(), _password.text);
      state.signInAs(user);
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed(MainShell.routeName);
    } on ApiException catch (error) {
      _password.clear();
      if (mounted) showToast(context, error.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      TextFormField(
                        controller: _email,
                        enabled: !_submitting,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const <String>[AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Work email',
                          prefixIcon: Icon(Icons.mail_outline, size: 20),
                        ),
                        validator: (value) {
                          final email = value?.trim() ?? '';
                          if (email.isEmpty) return 'Enter your work email';
                          if (!email.contains('@')) {
                            return 'Enter a valid email';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        enabled: !_submitting,
                        obscureText: true,
                        autofillHints: const <String>[AutofillHints.password],
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: const InputDecoration(
                          labelText: 'Password',
                          prefixIcon: Icon(Icons.lock_outline, size: 20),
                        ),
                        validator: (value) => (value == null || value.isEmpty)
                            ? 'Enter your password'
                            : null,
                      ),
                      const SizedBox(height: 20),
                      ElevatedButton(
                        onPressed: _submitting ? null : _submit,
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size(0, 52),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                ),
                              )
                            : const Text('Sign in'),
                      ),
                    ],
                  ),
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
