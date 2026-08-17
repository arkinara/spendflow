/// On-device persistence seam (#93), mirroring the repository-interface
/// pattern from #91: [AppState] talks to [LocalStore] only, never to
/// SharedPreferences or Hive directly, so the live implementation and the
/// test fake are interchangeable.
library;

/// One storage surface for settings (strings), collections (lists of maps)
/// and the single OCR draft blob (one map).
abstract class LocalStore {
  /// Hydrate any plugin caches. Must complete before the first read/write.
  Future<void> init();

  Future<String?> readString(String key);
  Future<void> writeString(String key, String value);

  Future<List<Map<String, dynamic>>?> readList(String key);
  Future<void> writeList(String key, List<Map<String, dynamic>> items);

  Future<Map<String, dynamic>?> readMap(String key);
  Future<void> writeMap(String key, Map<String, dynamic> value);

  Future<void> delete(String key);
}

/// In-memory [LocalStore] — the test fake and the no-op default.
///
/// Tests (and any [AppState] built without a store) never touch a platform
/// plugin, yet exercise the exact same interface the live app uses.
class InMemoryStore implements LocalStore {
  final Map<String, String> _strings = <String, String>{};
  final Map<String, List<Map<String, dynamic>>> _lists =
      <String, List<Map<String, dynamic>>>{};
  final Map<String, Map<String, dynamic>> _maps =
      <String, Map<String, dynamic>>{};

  @override
  Future<void> init() async {}

  @override
  Future<String?> readString(String key) async => _strings[key];

  @override
  Future<void> writeString(String key, String value) async {
    _strings[key] = value;
  }

  @override
  Future<List<Map<String, dynamic>>?> readList(String key) async {
    final list = _lists[key];
    if (list == null) return null;
    // Defensive copy: callers mutate the returned list at their peril.
    return List<Map<String, dynamic>>.of(list);
  }

  @override
  Future<void> writeList(String key, List<Map<String, dynamic>> items) async {
    _lists[key] = List<Map<String, dynamic>>.of(items);
  }

  @override
  Future<Map<String, dynamic>?> readMap(String key) async {
    final map = _maps[key];
    if (map == null) return null;
    return Map<String, dynamic>.of(map);
  }

  @override
  Future<void> writeMap(String key, Map<String, dynamic> value) async {
    _maps[key] = Map<String, dynamic>.of(value);
  }

  @override
  Future<void> delete(String key) async {
    _strings.remove(key);
    _lists.remove(key);
    _maps.remove(key);
  }
}
