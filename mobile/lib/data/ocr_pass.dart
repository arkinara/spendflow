import 'dart:typed_data';

import '../models/models.dart';

/// The OCR seam (#94): a frame in, an [OcrResult] out.
///
/// The capture screen depends on this interface only — never on a concrete
/// implementation — so the on-device (ML Kit) and demo passes can be swapped
/// without touching the screen again. The demo boots with [MockOcrPass]; the
/// live app wires the on-device ML Kit pass against the repository (#99).
abstract class OcrPass {
  /// Run OCR over one captured frame ([bytes], typically JPEG) and hand back
  /// the read fields plus per-field confidence/bbox.
  ///
  /// Throws [ApiError] when the backing service rejects or is unreachable;
  /// callers surface the message and let the user retake.
  Future<OcrResult> scanFrame(Uint8List bytes);
}
