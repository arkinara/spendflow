import 'package:flutter/material.dart';

import 'api/http_client.dart';
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
/// submit → sync journey keeps its context across route changes. The root
/// also owns the two cross-cutting HTTP concerns: the global 401 handler and
/// the boot-time `/api/me` session probe.
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
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    // Any 401 from any endpoint resets the session and routes to /login —
    // registered once, here, so no screen handles auth expiry itself.
    httpClient.setAuth401Handler(_handleUnauthorized);
    if (_ownsState) {
      // Cold-start session probe. Skipped when a test injected a prepared
      // state — those runs must not touch the network.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _bootstrap();
      });
    }
  }

  Future<void> _bootstrap() async {
    await _state.bootstrap();
    if (!mounted || !_state.signedIn) return;
    _routeTo(MainShell.routeName);
  }

  void _handleUnauthorized() {
    _state.signIn(false);
    if (!mounted) return;
    _routeTo(LoginScreen.routeName);
  }

  /// Navigate to [route] as a clean stack replacement, skipping when already
  /// there so a 401 while on /login cannot loop.
  void _routeTo(String route) {
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    final context = _navigatorKey.currentContext;
    if (context != null && ModalRoute.of(context)?.settings.name == route) {
      return;
    }
    navigator.pushNamedAndRemoveUntil(route, (_) => false);
  }

  @override
  void dispose() {
    httpClient.setAuth401Handler(null);
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
        navigatorKey: _navigatorKey,
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
