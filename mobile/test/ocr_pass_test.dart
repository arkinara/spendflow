import 'dart:typed_data';
import 'dart:ui' show Rect;

import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/data/fixtures.dart';
import 'package:spendflow_mobile/data/mock_ocr_pass.dart';
import 'package:spendflow_mobile/models/models.dart';

void main() {
  group('MockOcrPass (#94)', () {
    test('scanFrame returns an OcrResult with two low-confidence fields', () async {
      final result = await MockOcrPass().scanFrame(Uint8List.fromList(<int>[1, 2, 3]));

      expect(result.merchant, Fixtures.initialDraft.merchant);
      expect(result.amount, '391.830');
      final low = result.fields.values
          .where((f) => f.confidence == FieldConfidence.low);
      expect(low, hasLength(2));
      expect(
        result.fields[OcrFieldKey.tax]?.confidence,
        FieldConfidence.low,
      );
      expect(
        result.fields[OcrFieldKey.amount]?.confidence,
        FieldConfidence.low,
      );
    });
  });

  group('OcrResult', () {
    test('toOcrDraft flattens into the existing OcrDraft shape', () {
      const result = OcrResult(
        merchant: 'Warung Sederhana',
        date: '15/07/2026',
        amount: '391.830',
        tax: '38.830',
        currency: 'IDR',
        category: 'Meals',
        description: 'Team dinner with PT Nusantara',
        fields: <OcrFieldKey, FieldResult>{
          OcrFieldKey.tax: FieldResult(
            value: '38.830',
            confidence: FieldConfidence.low,
            bbox: Rect.fromLTRB(4, 8, 40, 22),
          ),
        },
      );

      final draft = result.toOcrDraft();

      expect(draft.merchant, 'Warung Sederhana');
      expect(draft.amount, '391.830');
      expect(draft.tax, '38.830');
      expect(draft.currency, 'IDR');
      expect(draft.category, 'Meals');
      expect(draft.description, 'Team dinner with PT Nusantara');
      // The draft shape carries the flat values only — confidence/bbox stay out.
      expect(draft.valueOf(OcrFieldKey.tax), '38.830');
    });

    test('FieldConfidence.high vs .low serializes and round-trips', () {
      const high = FieldResult(value: '391.830', confidence: FieldConfidence.high);
      const low = FieldResult(
        value: '38.830',
        confidence: FieldConfidence.low,
        bbox: Rect.fromLTRB(1, 2, 3, 4),
      );

      final highJson = high.toJson();
      final lowJson = low.toJson();
      expect(highJson['confidence'], 'high');
      expect(lowJson['confidence'], 'low');
      expect(lowJson['bbox'], <String, double>{
        'left': 1,
        'top': 2,
        'right': 3,
        'bottom': 4,
      });

      expect(FieldResult.fromJson(highJson).confidence, FieldConfidence.high);
      expect(FieldResult.fromJson(lowJson).confidence, FieldConfidence.low);
      expect(FieldResult.fromJson(lowJson).bbox, Rect.fromLTRB(1, 2, 3, 4));
    });
  });
}
