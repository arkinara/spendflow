import 'dart:typed_data';
import 'dart:ui' show Rect;

import '../models/models.dart';
import 'fixtures.dart';
import 'ocr_pass.dart';

/// Demo-mode [OcrPass]: returns the fixtures draft as an [OcrResult], with two
/// fields marked low-confidence so the confirmation screen's "CHECK THIS" chip
/// still fires for the demo. No network, no camera hardware required.
class MockOcrPass implements OcrPass {
  MockOcrPass();

  @override
  Future<OcrResult> scanFrame(Uint8List bytes) async {
    final draft = Fixtures.initialDraft;
    return OcrResult(
      merchant: draft.merchant,
      date: draft.date,
      amount: draft.amount,
      tax: draft.tax,
      currency: draft.currency,
      category: draft.category,
      description: draft.description,
      fields: <OcrFieldKey, FieldResult>{
        OcrFieldKey.merchant: const FieldResult(
          value: 'Warung Sederhana',
          confidence: FieldConfidence.high,
        ),
        OcrFieldKey.date: const FieldResult(
          value: '15/07/2026',
          confidence: FieldConfidence.high,
        ),
        // Two fields come back low-confidence so the demo proves nothing is
        // submitted straight from raw OCR without a human check.
        OcrFieldKey.tax: const FieldResult(
          value: '38.830',
          confidence: FieldConfidence.low,
          bbox: Rect.zero,
        ),
        OcrFieldKey.amount: const FieldResult(
          value: '391.830',
          confidence: FieldConfidence.low,
          bbox: Rect.zero,
        ),
      },
    );
  }
}
