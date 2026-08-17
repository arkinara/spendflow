import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app.dart';
import 'state/app_state.dart';
import 'storage/hive_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Boot order (#93): ensureInitialized → LocalStore.init → AppState.create
  // → first frame. Hydrating before runApp means a kill-and-relaunch cycle
  // starts on fully recovered queue / draft / settings.
  final state = await AppState.create(store: HiveStore());
  // Portrait only: every screen is a single column and the capture viewfinder
  // assumes a tall frame.
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  runApp(SpendFlowApp(initialState: state, bootstrap: true));
}
