import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/util/currency.dart';

void main() {
  group('formatIdr', () {
    test('groups thousands with dots and carries no decimals', () {
      expect(formatIdr(4787000), 'Rp 4.787.000');
      expect(formatIdr(391830), 'Rp 391.830');
      expect(formatIdr(0), 'Rp 0');
      expect(formatIdr(999), 'Rp 999');
      expect(formatIdr(1000), 'Rp 1.000');
    });

    test('rounds fractional amounts — IDR has no sub-unit', () {
      expect(formatIdr(1000.4), 'Rp 1.000');
      expect(formatIdr(1000.6), 'Rp 1.001');
    });

    test('keeps the sign on negative amounts', () {
      expect(formatIdr(-350000), 'Rp -350.000');
    });
  });

  group('parseIdr', () {
    test('reads the dotted strings the OCR fields hold', () {
      expect(parseIdr('391.830'), 391830);
      expect(parseIdr('Rp 4.787.000'), 4787000);
      expect(parseIdr('38830'), 38830);
    });

    test('returns zero for input with no digits', () {
      expect(parseIdr(''), 0);
      expect(parseIdr('abc'), 0);
    });
  });
}
