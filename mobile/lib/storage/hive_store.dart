import 'package:hive_flutter/hive_flutter.dart';

import 'local_store.dart';

/// [LocalStore] over Hive (#93) — the queue / draft / inbox side, where the
/// blobs are slightly larger JSON structures.
///
/// No type adapters are registered (no hive_generator / build_runner):
/// everything is stored as plain Hive-native maps, lists and strings, which
/// is exactly why the data shapes were kept small and migration-free.
class HiveStore implements LocalStore {
  static const String _settingsBox = 'settings';
  static const String _queueBox = 'queue';
  static const String _draftBox = 'draft';

  Box<dynamic>? _settings;
  Box<dynamic>? _queue;
  Box<dynamic>? _draft;

  @override
  Future<void> init() async {
    await Hive.initFlutter();
    _settings = await Hive.openBox<dynamic>(_settingsBox);
    _queue = await Hive.openBox<dynamic>(_queueBox);
    _draft = await Hive.openBox<dynamic>(_draftBox);
  }

  Box<dynamic> get _strings => _opened(_settings, _settingsBox);
  Box<dynamic> get _lists => _opened(_queue, _queueBox);
  Box<dynamic> get _maps => _opened(_draft, _draftBox);

  Box<dynamic> _opened(Box<dynamic>? box, String name) {
    if (box == null) {
      throw StateError('HiveStore box "$name" used before init()');
    }
    return box;
  }

  @override
  Future<String?> readString(String key) async =>
      _strings.get(key) as String?;

  @override
  Future<void> writeString(String key, String value) =>
      _strings.put(key, value);

  @override
  Future<List<Map<String, dynamic>>?> readList(String key) async {
    final dynamic raw = _lists.get(key);
    if (raw == null) return null;
    return (raw as List<dynamic>)
        .map((item) => Map<String, dynamic>.from(item as Map<dynamic, dynamic>))
        .toList();
  }

  @override
  Future<void> writeList(String key, List<Map<String, dynamic>> items) =>
      _lists.put(key, items);

  @override
  Future<Map<String, dynamic>?> readMap(String key) async {
    final dynamic raw = _maps.get(key);
    if (raw == null) return null;
    return Map<String, dynamic>.from(raw as Map<dynamic, dynamic>);
  }

  @override
  Future<void> writeMap(String key, Map<String, dynamic> value) =>
      _maps.put(key, value);

  @override
  Future<void> delete(String key) async {
    // The interface is key-addressed, not box-addressed, so a delete fans
    // out to every box — callers never need to know where a key lives.
    await _settings?.delete(key);
    await _queue?.delete(key);
    await _draft?.delete(key);
  }
}
