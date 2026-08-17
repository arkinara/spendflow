import 'package:flutter/material.dart';

import '../state/app_state.dart';
import 'approvals_screen.dart';
import 'capture_screen.dart';
import 'claims_screen.dart';
import 'home_screen.dart';
import 'queue_screen.dart';
import 'settings_screen.dart';

/// The four primary destinations, with the capture FAB riding above them and
/// Settings as a pushed route off the bottom bar.
///
/// Tab state is kept in an [IndexedStack] so scroll position and filters
/// survive a switch — the same behaviour the web app's rail has.
class MainShell extends StatefulWidget {
  const MainShell({this.initialIndex = 0, super.key});

  final int initialIndex;

  /// Index of the Settings destination. Unlike the tabs it pushes a route
  /// (/settings) instead of switching the stack.
  static const int settingsIndex = 4;

  static const String routeName = '/home';

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  late int _index = widget.initialIndex;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: <Widget>[
          HomeScreen(onSeeAllClaims: () => setState(() => _index = 1)),
          const ClaimsScreen(),
          const QueueScreen(),
          const ApprovalsScreen(),
        ],
      ),
      // Capture is the employee's primary action, but not on Queue (where Sync
      // owns the bottom bar) or Approvals (a different job entirely).
      floatingActionButton: _index <= 1
          ? FloatingActionButton(
              onPressed: () =>
                  Navigator.of(context).pushNamed(CaptureScreen.routeName),
              tooltip: 'Capture a receipt',
              child: const Icon(Icons.photo_camera_outlined, size: 26),
            )
          : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          if (i == MainShell.settingsIndex) {
            Navigator.of(context).pushNamed(SettingsScreen.routeName);
            return;
          }
          setState(() => _index = i);
        },
        destinations: <Widget>[
          const NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          const NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Claims',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: state.pendingQueueCount > 0,
              label: Text('${state.pendingQueueCount}'),
              child: Icon(
                state.online ? Icons.cloud_outlined : Icons.cloud_off_outlined,
              ),
            ),
            label: 'Queue',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: state.inbox.isNotEmpty,
              label: Text('${state.inbox.length}'),
              child: const Icon(Icons.inbox_outlined),
            ),
            selectedIcon: const Icon(Icons.inbox),
            label: 'Approvals',
          ),
          const NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
