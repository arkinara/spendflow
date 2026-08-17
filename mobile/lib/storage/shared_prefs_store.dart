import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';

/// [LocalStore] over SharedPreferences (#93) — the tiny key-value side
/// (design variant, offline toggle) and any small JSON blob.
///
/// Lists and maps are stored as JSON strings: SharedPreferences has no
/// structured value type beyond primitive sets.
class SharedPrefsStore implements LocalStore {
  SharedPreferences? _prefs;

  @override
  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  SharedPreferences get _p {
    final prefs = _prefs;
    if (prefs == null) {
      throw StateError('SharedPrefsStore used before init()');
    }
    return prefs;
  }

  @override
  Future<String?> readString(String key) async => _p.getString(key);

  @override
  Future<void> writeString(String key, String value) =>
      _p.setString(key, value);

  @override
  Future<List<Map<String, dynamic>>?> readList(String key) async {
    final raw = _p.getString(key);
    if (raw == null) return null;
    final decoded = jsonDecode(raw) as List<dynamic>;
    return decoded
        .map((item) => Map<String, dynamic>.from(item as Map<dynamic, dynamic>))
        .toList();
  }

  @override
  Future<void> writeList(String key, List<Map<String, dynamic>> items) =>
      _p.setString(key, jsonEncode(items));

  @override
  Future<Map<String, dynamic>?> readMap(String key) async {
    final raw = _p.getString(key);
    if (raw == null) return null;
    return Map<String, dynamic>.from(jsonDecode(raw) as Map<dynamic, dynamic>);
  }

  @override
  Future<void> writeMap(String key, Map<String, dynamic> value) =>
      _p.setString(key, jsonEncode(value));

  @override
  Future<void> delete(String key) => _p.remove(key);
}
