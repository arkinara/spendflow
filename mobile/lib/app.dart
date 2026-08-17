import 'package:flutter/material.dart';

import 'api/http_client.dart';
import 'data/claim_repository.dart';
import 'screens/capture_screen.dart';
import 'screens/claim_detail_screen.dart';
import 'screens/confirm_screen.dart';
import 'screens/draft_screen.dart';
import 'screens/login_screen.dart';
import 'screens/queue_screen.dart';
import 'screens/settings_screen.dart';
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
  const SpendFlowApp({
    this.initialState,
    this.initialRepository,
    this.bootstrap = false,
    super.key,
  });

  /// Injected by tests to start from a specific point in the flow.
  final AppState? initialState;

  /// Data seam injected by tests (#91). Production wiring — swapping this for
  /// [RestClaimRepository] — lands in #90b/#90c; the default stays demo
  /// fixtures so offline behaviour is unchanged.
  final ClaimRepository? initialRepository;

  /// Run the cold-start `/api/me` probe even though an [initialState] was
  /// injected (#93): production boot passes a hydrated state and still needs
  /// the session probe, while tests omit it so they never touch the network.
  final bool bootstrap;

  @override
  State<SpendFlowApp> createState() => _SpendFlowAppState();
}

class _SpendFlowAppState extends State<SpendFlowApp> {
  late final AppState _state =
      widget.initialState ?? AppState(repository: widget.initialRepository);
  late final bool _ownsState = widget.initialState == null;
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    // Any 401 from any endpoint resets the session and routes to /login —
    // registered once, here, so no screen handles auth expiry itself.
    httpClient.setAuth401Handler(_handleUnauthorized);
    if (_ownsState || widget.bootstrap) {
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
      child: _SpendFlowMaterialApp(
        navigatorKey: _navigatorKey,
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
      case SettingsScreen.routeName:
        return _page(const SettingsScreen(), settings);
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

/// Builds the [MaterialApp] below [AppScope] so it subscribes to [AppState]:
/// a theme-mode flip notifies and the whole app re-resolves light/dark in
/// place — no route is pushed or popped, the navigator stack stays put.
class _SpendFlowMaterialApp extends StatelessWidget {
  const _SpendFlowMaterialApp({
    required this.navigatorKey,
    required this.onGenerateRoute,
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final Route<dynamic>? Function(RouteSettings) onGenerateRoute;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    return MaterialApp(
      title: 'SpendFlow',
      debugShowCheckedModeBanner: false,
      theme: buildSpendFlowTheme(),
      darkTheme: buildSpendFlowTheme(brightness: Brightness.dark),
      themeMode: state.themeMode,
      navigatorKey: navigatorKey,
      initialRoute: LoginScreen.routeName,
      onGenerateRoute: onGenerateRoute,
    );
  }
}
