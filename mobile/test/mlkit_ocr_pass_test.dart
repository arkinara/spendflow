import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:spendflow_mobile/data/mlkit_ocr_pass.dart';
import 'package:spendflow_mobile/models/models.dart';

/// A [TextRecognizer] that never touches the platform channel — returns a
/// canned [RecognizedText] so the pass's line-clustering heuristic can be
/// unit-tested without a device/camera stack (honest caveat #99).
class _FakeTextRecognizer extends TextRecognizer {
  _FakeTextRecognizer({this.result});

  final RecognizedText? result;
  int processCalls = 0;
  bool closed = false;

  @override
  Future<RecognizedText> processImage(InputImage inputImage) async {
    processCalls += 1;
    return result ?? RecognizedText(text: '', blocks: const <TextBlock>[]);
  }

  @override
  Future<void> close() async {
    closed = true;
  }
}

TextLine _line(String text, Rect box) => TextLine(
      text: text,
      elements: const <TextElement>[],
      boundingBox: box,
      recognizedLanguages: const <String>[],
      cornerPoints: const <Point<int>>[],
      confidence: 1.0,
      angle: 0,
    );

TextBlock _block(String text, List<TextLine> lines) => TextBlock(
      text: text,
      lines: lines,
      boundingBox: lines.first.boundingBox,
      recognizedLanguages: const <String>[],
      cornerPoints: const <Point<int>>[],
    );

/// A typical IDR receipt read: merchant up top, then date, total and the
/// PPN (VAT) line — exactly the layout the #99 heuristic targets.
RecognizedText _receipt() => RecognizedText(
      text: 'WARUNG SEDERHANA\n15/07/2026\nTotal Rp 391.830\nPPN 11%',
      blocks: <TextBlock>[
        _block('WARUNG SEDERHANA',
            <TextLine>[_line('WARUNG SEDERHANA', Rect.fromLTRB(10, 10, 200, 30))]),
        _block(
            '15/07/2026', <TextLine>[_line('15/07/2026', Rect.fromLTRB(10, 40, 120, 55))]),
        _block('Total Rp 391.830',
            <TextLine>[_line('Total Rp 391.830', Rect.fromLTRB(10, 70, 220, 85))]),
        _block('PPN 11%', <TextLine>[_line('PPN 11%', Rect.fromLTRB(10, 95, 100, 110))]),
      ],
    );

void main() {
  group('MlKitOcrPass (#99)', () {
    test('scanFrame maps recognized lines into merchant/date/amount/tax',
        () async {
      final pass =
          MlKitOcrPass(recognizer: _FakeTextRecognizer(result: _receipt()));
      final bytes = Uint8List.fromList(<int>[1, 2, 3]);

      final result = await pass.scanFrame(bytes);

      expect(result.merchant, 'WARUNG SEDERHANA');
      expect(result.date, '15/07/2026');
      expect(result.amount, 'Total Rp 391.830');
      expect(result.tax, 'PPN 11%');
      expect(result.currency, 'IDR');
      expect(result.category, isEmpty);
      // ML Kit carries no per-word confidence — every match reports high,
      // with the source-line bounding box mapped through.
      expect(result.fields[OcrFieldKey.merchant]?.confidence,
          FieldConfidence.high);
      expect(result.fields[OcrFieldKey.merchant]?.bbox,
          Rect.fromLTRB(10, 10, 200, 30));
      expect(
          result.fields[OcrFieldKey.amount]?.bbox, Rect.fromLTRB(10, 70, 220, 85));
      expect(result.fields[OcrFieldKey.tax]?.confidence,
          FieldConfidence.high);
    });

    test('scanFrame with no recognized lines returns an empty OcrResult',
        () async {
      final pass = MlKitOcrPass(
        recognizer: _FakeTextRecognizer(
          result: RecognizedText(text: '', blocks: const <TextBlock>[]),
        ),
      );

      final result = await pass.scanFrame(Uint8List.fromList(<int>[9]));

      expect(result.merchant, isEmpty);
      expect(result.date, isEmpty);
      expect(result.amount, isEmpty);
      expect(result.tax, isEmpty);
      expect(result.currency, 'IDR');
      // The fallback still reports the merchant slot as low-confidence so the
      // confirm screen's "CHECK THIS" chip fires instead of silently passing.
      expect(result.fields, hasLength(1));
      expect(result.fields[OcrFieldKey.merchant]?.value, isEmpty);
      expect(result.fields[OcrFieldKey.merchant]?.confidence,
          FieldConfidence.low);
    });

    test('a tax line that looks estimated is low-confidence', () async {
      final pass = MlKitOcrPass(
        recognizer: _FakeTextRecognizer(
          result: RecognizedText(
            text: 'WARUNG SEDERHANA\nPPN est. 38.830\nTotal Rp 391.830',
            blocks: <TextBlock>[
              _block('WARUNG SEDERHANA',
                  <TextLine>[_line('WARUNG SEDERHANA', Rect.zero)]),
              _block('PPN est. 38.830',
                  <TextLine>[_line('PPN est. 38.830', Rect.zero)]),
              _block('Total Rp 391.830',
                  <TextLine>[_line('Total Rp 391.830', Rect.zero)]),
            ],
          ),
        ),
      );

      final result = await pass.scanFrame(Uint8List.fromList(<int>[1]));

      expect(result.tax, 'PPN est. 38.830');
      expect(result.fields[OcrFieldKey.tax]?.confidence, FieldConfidence.low);
      expect(result.fields[OcrFieldKey.merchant]?.confidence,
          FieldConfidence.high);
      expect(result.fields[OcrFieldKey.amount]?.confidence,
          FieldConfidence.high);
    });

    test('constructs and disposes without error', () {
      final pass = MlKitOcrPass();
      pass.dispose();
      // A double dispose is idempotent.
      pass.dispose();
    });

    test('dispose closes the underlying TextRecognizer', () {
      final fake = _FakeTextRecognizer(result: _receipt());
      final pass = MlKitOcrPass(recognizer: fake);

      expect(fake.closed, isFalse);
      pass.dispose();

      expect(fake.closed, isTrue);
    });
  });
}
