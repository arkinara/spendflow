import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:spendflow_mobile/storage/local_store.dart';
import 'package:spendflow_mobile/storage/shared_prefs_store.dart';

void main() {
  group('InMemoryStore', () {
    test('round-trips strings, lists and maps — same shape as the real stores',
        () async {
      final store = InMemoryStore();
      await store.init();
      await store.writeString('variant', 'homeEditorial');
      await store.writeList('queue', <Map<String, dynamic>>[
        <String, dynamic>{'id': 'q1', 'amount': 64000},
      ]);
      await store.writeMap('draft', <String, dynamic>{'merchant': 'Kopi'});

      expect(await store.readString('variant'), 'homeEditorial');
      expect(await store.readList('queue'), <Map<String, dynamic>>[
        <String, dynamic>{'id': 'q1', 'amount': 64000},
      ]);
      expect(await store.readMap('draft'), <String, dynamic>{'merchant': 'Kopi'});
    });

    test('delete removes the key', () async {
      final store = InMemoryStore();
      await store.init();
      await store.writeString('variant', 'standard');
      await store.writeList('queue', const <Map<String, dynamic>>[]);

      await store.delete('variant');
      await store.delete('queue');

      expect(await store.readString('variant'), isNull);
      expect(await store.readList('queue'), isNull);
    });

    test('missing keys read as null', () async {
      final store = InMemoryStore();
      await store.init();
      expect(await store.readString('nope'), isNull);
      expect(await store.readList('nope'), isNull);
      expect(await store.readMap('nope'), isNull);
    });
  });

  group('SharedPrefsStore', () {
    test('round-trips a string key', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final store = SharedPrefsStore();
      await store.init();

      await store.writeString('variant', 'syncQuiet');

      expect(await store.readString('variant'), 'syncQuiet');
    });

    test('round-trips a list of maps across a simulated restart', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final items = <Map<String, dynamic>>[
        <String, dynamic>{'id': 'q1', 'title': 'Grab', 'amount': 64000},
        <String, dynamic>{'id': 'q2', 'title': 'Kopi', 'amount': 112000},
      ];
      final writer = SharedPrefsStore();
      await writer.init();
      await writer.writeList('queue', items);

      // Fresh store over the same underlying preferences = relaunch.
      final reader = SharedPrefsStore();
      await reader.init();

      expect(await reader.readList('queue'), items);
    });

    test('round-trips a single map', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final store = SharedPrefsStore();
      await store.init();

      await store.writeMap(
          'draft', <String, dynamic>{'merchant': 'Kopi Toko Djawa'});

      expect(await store.readMap('draft'),
          <String, dynamic>{'merchant': 'Kopi Toko Djawa'});
    });

    test('delete removes the key', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final store = SharedPrefsStore();
      await store.init();
      await store.writeString('offline', 'true');

      await store.delete('offline');

      expect(await store.readString('offline'), isNull);
    });
  });
}
