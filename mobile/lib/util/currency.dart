/// Indonesian Rupiah formatting.
///
/// IDR carries no decimals and groups thousands with a dot, so a claim reads
/// `Rp 4.787.000`. Hand-rolled rather than pulled from `intl`: it is four lines
/// and keeps the app dependency-free for Phase 1.
String formatIdr(num amount) => 'Rp ${groupDigits(amount.round())}';

/// `4787000` -> `4.787.000`. Negative values keep their sign.
String groupDigits(int value) {
  final negative = value < 0;
  final digits = value.abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return negative ? '-${buffer.toString()}' : buffer.toString();
}

/// Read the dotted-thousands strings the OCR fields hold back into a number.
/// Anything that is not a digit is dropped, so `"391.830"` and `"Rp 391.830"`
/// both parse to `391830`.
int parseIdr(String value) {
  final digits = value.replaceAll(RegExp(r'[^0-9]'), '');
  if (digits.isEmpty) return 0;
  return int.tryParse(digits) ?? 0;
}
