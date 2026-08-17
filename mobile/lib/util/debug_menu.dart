/// True in debug builds, false in release (product) builds — the long-press
/// variant switcher is a design-review tool and has no place in production.
const bool kDebugMenu = !bool.fromEnvironment('dart.vm.product');

/// Whether the debug-only menus are live. Mirrors [kDebugMenu] in every build;
/// tests flip this to false to exercise the release-build no-op path.
bool debugMenuEnabled = kDebugMenu;
