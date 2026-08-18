import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

import '../models/models.dart';
import 'ocr_pass.dart';

/// Live [OcrPass] backed by Google ML Kit's on-device text recognizer (#99).
///
/// The locked product decision is on-device OCR — no server round trip, no
/// image upload for the read itself. [scanFrame] writes the captured frame to
/// a temp file (the ML Kit byte constructor needs raw-pixel metadata we don't
/// have for a JPEG) and runs the Latin-script recognizer over it, then maps the
/// recognized lines to [OcrFieldKey]s with a small clustering heuristic.
///
/// ML Kit does not expose per-word confidence, so every matched field reports
/// [FieldConfidence.high] — except tax, which drops to [FieldConfidence.low]
/// when the line looks estimated (`~`, `±`, "est.", "approx"). A frame with
/// no recognizable text returns an empty low-confidence [OcrResult] rather
/// than throwing, so the confirm screen's review/retake flow stays intact.
class MlKitOcrPass implements OcrPass {
  MlKitOcrPass({TextRecognizer? recognizer})
      : _recognizer =
            recognizer ?? TextRecognizer(script: TextRecognitionScript.latin);

  final TextRecognizer _recognizer;
  bool _closed = false;

  @override
  Future<OcrResult> scanFrame(Uint8List bytes) async {
    File? temp;
    try {
      temp = await _writeTemp(bytes);
      final recognized = await _recognizer.processImage(
        InputImage.fromFilePath(temp.path),
      );
      return _map(recognized);
    } catch (error, stack) {
      // A failed or empty read (no ML Kit native library on this build, a
      // corrupt frame) must not crash the capture flow — an empty
      // low-confidence result lets the user review/retake instead (negative
      // AC #99).
      debugPrint('SpendFlow ML Kit OCR failed: $error\n$stack');
      return _emptyResult();
    } finally {
      try {
        await temp?.delete();
      } catch (_) {
        // Temp-file cleanup is best effort.
      }
    }
  }

  /// Close the underlying [TextRecognizer] and release its native resources.
  /// Idempotent — double disposes are harmless. A build without the ML Kit
  /// native library must not crash the app on dispose, so close errors are
  /// swallowed and logged.
  void dispose() {
    if (_closed) return;
    _closed = true;
    unawaited(_recognizer.close().catchError((Object error) {
      debugPrint('SpendFlow ML Kit recognizer close failed: $error');
    }));
  }

  Future<File> _writeTemp(Uint8List bytes) async {
    final file = File(
      '${Directory.systemTemp.path}/spendflow_${DateTime.now().microsecondsSinceEpoch}.jpg',
    );
    await file.writeAsBytes(bytes, flush: true);
    return file;
  }

  static final RegExp _datePattern = RegExp(r'^\d{1,2}/\d{1,2}/\d{2,4}$');
  static final RegExp _amountPattern = RegExp(r'^\d[\d.,]*$');
  static final RegExp _taxLabels = RegExp(r'(tax|ppn|pph|vat|pajak)');
  static final RegExp _estimated = RegExp(r'[~±]|est\.?|approx');

  /// First-pass line clustering: the first line that plausibly matches each
  /// field wins, so typical IDR receipts read merchant/date/amount/tax in
  /// one pass. Deliberately loose — see the #99 honest caveats.
  OcrResult _map(RecognizedText recognized) {
    final lines = <TextLine>[
      for (final block in recognized.blocks) ...block.lines,
    ];
    if (lines.isEmpty) return _emptyResult();

    String? merchant;
    String? date;
    String? amount;
    String? tax;
    final fields = <OcrFieldKey, FieldResult>{};

    for (final line in lines) {
      final text = line.text.trim();
      if (text.isEmpty) continue;
      final lower = text.toLowerCase();
      final isDate = date == null && _datePattern.hasMatch(text);
      final isTax = tax == null &&
          (lower.contains('%') || _taxLabels.hasMatch(lower));
      final isAmount = amount == null &&
          (lower.contains('rp') || _amountPattern.hasMatch(text));
      final isMerchant = merchant == null && !isDate && !isTax && !isAmount;

      if (isMerchant) {
        merchant = text;
        fields[OcrFieldKey.merchant] = FieldResult(
          value: text,
          confidence: FieldConfidence.high,
          bbox: line.boundingBox,
        );
      } else if (isDate) {
        date = text;
        fields[OcrFieldKey.date] = FieldResult(
          value: text,
          confidence: FieldConfidence.high,
          bbox: line.boundingBox,
        );
      } else if (isTax) {
        tax = text;
        fields[OcrFieldKey.tax] = FieldResult(
          value: text,
          confidence: _taxConfidence(lower),
          bbox: line.boundingBox,
        );
      } else if (isAmount) {
        amount = text;
        fields[OcrFieldKey.amount] = FieldResult(
          value: text,
          confidence: FieldConfidence.high,
          bbox: line.boundingBox,
        );
      }
    }

    return OcrResult(
      merchant: merchant ?? '',
      date: date ?? '',
      amount: amount ?? '',
      tax: tax ?? '',
      currency: 'IDR',
      category: '',
      description: '',
      fields: fields,
    );
  }

  /// ML Kit reports no per-word confidence, so everything is [FieldConfidence.high]
  /// except an estimated-looking tax line, which drops to [FieldConfidence.low]
  /// so the confirm screen's "CHECK THIS" chip still fires.
  static FieldConfidence _taxConfidence(String lower) =>
      _estimated.hasMatch(lower) ? FieldConfidence.low : FieldConfidence.high;

  OcrResult _emptyResult() => OcrResult(
        merchant: '',
        date: '',
        amount: '',
        tax: '',
        currency: 'IDR',
        category: '',
        description: '',
        fields: const <OcrFieldKey, FieldResult>{
          OcrFieldKey.merchant: FieldResult(
            value: '',
            confidence: FieldConfidence.low,
          ),
        },
      );
}
