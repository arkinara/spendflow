import 'package:flutter/material.dart';

import 'screens/capture_screen.dart';
import 'screens/claim_detail_screen.dart';
import 'screens/confirm_screen.dart';
import 'screens/draft_screen.dart';
import 'screens/login_screen.dart';
import 'screens/queue_screen.dart';
import 'screens/shell.dart';
import 'screens/success_screen.dart';
import 'state/app_state.dart';
import 'theme/app_theme.dart';

/// Root of the SpendFlow mobile client.
///
/// One [AppState] owns the whole session, so the capture → confirm → draft →
/// submit → sync journey keeps its context across route changes.
class SpendFlowApp extends StatefulWidget {
  const SpendFlowApp({this.initialState, super.key});

  /// Injected by tests to start from a specific point in the flow.
  final AppState? initialState;

  @override
  State<SpendFlowApp> createState() => _SpendFlowAppState();
}

class _SpendFlowAppState extends State<SpendFlowApp> {
  late final AppState _state = widget.initialState ?? AppState();
  late final bool _ownsState = widget.initialState == null;

  @override
  void dispose() {
    if (_ownsState) _state.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: _state,
      child: MaterialApp(
        title: 'SpendFlow',
        debugShowCheckedModeBanner: false,
        theme: buildSpendFlowTheme(),
        initialRoute: LoginScreen.routeName,
        onGenerateRoute: _onGenerateRoute,
      ),
    );
  }

  Route<dynamic>? _onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case LoginScreen.routeName:
        return _page(const LoginScreen(), settings);
      case MainShell.routeName:
        return _page(const MainShell(), settings);
      case CaptureScreen.routeName:
        return _page(const CaptureScreen(), settings);
      case ConfirmScreen.routeName:
        return _page(const ConfirmScreen(), settings);
      case DraftScreen.routeName:
        return _page(const DraftScreen(), settings);
      case QueueScreen.routeName:
        return _page(const QueueScreen(standalone: true), settings);
      case SuccessScreen.routeName:
        return _page(const SuccessScreen(), settings);
      case ClaimDetailScreen.routeName:
        final id = settings.arguments as String?;
        return _page(ClaimDetailScreen(claimId: id ?? ''), settings);
      default:
        return null;
    }
  }

  MaterialPageRoute<void> _page(Widget child, RouteSettings settings) {
    return MaterialPageRoute<void>(builder: (_) => child, settings: settings);
  }
}
