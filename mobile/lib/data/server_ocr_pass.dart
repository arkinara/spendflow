import 'dart:typed_data';

import '../api/http_client.dart';
import '../models/models.dart';
import 'ocr_pass.dart';

/// Live [OcrPass] over the #90 [HttpClient] seam: POSTs the captured frame as
/// multipart/form-data to `/api/mobile/ocr`.
///
/// The BE endpoint is not landed yet — a 404/501 surfaces as [ApiError] from
/// the [HttpClient] contract, exactly like any other 4xx/5xx, and the capture
/// screen surfaces the message so the user can retake.
class ServerOcrPass implements OcrPass {
  ServerOcrPass({HttpClient? client}) : _client = client ?? httpClient;

  final HttpClient _client;

  @override
  Future<OcrResult> scanFrame(Uint8List bytes) async {
    final data = await _client.upload(
      path: '/api/mobile/ocr',
      fields: const <String, String>{},
      bytes: bytes,
      filename: 'receipt.jpg',
    );
    final json =
        data is Map<String, dynamic> ? data : const <String, dynamic>{};
    return OcrResult.fromJson(json);
  }
}
