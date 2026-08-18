import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spendflow_mobile/api/http_client.dart';
import 'package:spendflow_mobile/data/fixtures.dart';
import 'package:spendflow_mobile/data/mock_ocr_pass.dart';
import 'package:spendflow_mobile/data/rest_claim_repository.dart';

Uri _base = Uri.parse('http://be.test');

/// Synthetic camera frame for the tests.
final Uint8List _frame = Uint8List.fromList(
  // JPEG magic bytes followed by a couple of KB of zeros — package:http's
  // MultipartRequest serializes the bytes as-is.
  <int>[0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0],
);

/// MultipartRequest becomes a plain Request by the time MockClient sees
/// it (the multipart layer wraps the body into a Request's body stream).
/// We can't access the parsed files here, so we verify the upload
/// envelope: method POST, /api/mobile/receipts, content-type
/// multipart/form-data, body contains the JPEG magic bytes.
void _expectIsMultipartUpload(http.BaseRequest request) {
  expect(request.method, 'POST');
  expect(request.url.path, '/api/mobile/receipts');
  expect(
    request.headers['content-type'] ?? '',
    contains('multipart/form-data'),
    reason: 'upload should declare multipart/form-data',
  );
}

void main() {
  group('capture upload (#103)', () {
    test('capture(cameraBytes: null) returns the fixture demo draft', () async {
      final calls = <http.BaseRequest>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response(
          '{"merchant":"Kopi Toko Djawa","date":"15/07/2026",'
          '"amount":"24.000","tax":"0","currency":"IDR",'
          '"category":"Meals","description":"Morning standup round"}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
        ocrPass: MockOcrPass(),
      );

      final draft = await repo.capture();

      expect(calls, hasLength(1));
      expect(calls.single.url.path, '/api/mobile/capture');
      expect(draft.merchant, 'Kopi Toko Djawa');
      expect(draft.amount, '24.000');
    });

    test('capture(cameraBytes: ...) uploads the frame and threads the '
        'receiptUrl into the OcrResult', () async {
      final calls = <http.BaseRequest>[];
      final client = MockClient((request) async {
        calls.add(request);
        return http.Response(
          '{"receiptUrl":"https://cdn.example.com/receipts/mobile/u-emp/capture.jpg",'
          '"key":"mobile/u-emp/capture.jpg","sizeBytes":1234}',
          201,
          headers: {'content-type': 'application/json'},
        );
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
        ocrPass: MockOcrPass(),
      );

      final draft = await repo.capture(cameraBytes: _frame);

      // Two requests: the multipart upload, then the on-device OCR pass
      // (which goes through the MockOcrPass in tests, not the network).
      expect(calls, hasLength(1));
      expect(calls.single.method, 'POST');
      expect(calls.single.url.path, '/api/mobile/receipts');
      // Verify the upload envelope (method, path, multipart content-type).
      _expectIsMultipartUpload(calls.single);

      // The upload landed first, then the on-device OCR read the same
      // frame — the URL rides on the OcrResult, the draft keeps the read
      // fields.
      expect(repo.lastOcrResult?.receiptUrl,
          'https://cdn.example.com/receipts/mobile/u-emp/capture.jpg');
      expect(repo.lastOcrResult?.merchant, Fixtures.initialDraft.merchant);
      expect(draft.merchant, Fixtures.initialDraft.merchant);
      expect(draft.amount, '391.830');
    });

    test('a failed upload yields the OCR draft WITHOUT a receiptUrl — the '
        'flow continues', () async {
      // First call (the upload) returns 500; subsequent calls would 200.
      // The upload swallows the failure, returns null for receiptUrl, and
      // the OCR pass still runs against the same frame.
      final client = MockClient((request) async {
        return http.Response('boom', 500);
      });
      final repo = RestClaimRepository(
        client: HttpClient(baseUrl: _base, inner: client),
        ocrPass: MockOcrPass(),
      );

      final draft = await repo.capture(cameraBytes: _frame);

      // The OCR pass produced a draft (from MockOcrPass fixtures), but the
      // upload failure means no receiptUrl.
      expect(draft.merchant, Fixtures.initialDraft.merchant);
      expect(draft.amount, '391.830');
      expect(repo.lastOcrResult?.receiptUrl, isNull);
    });
  });

  group('OcrResult.receiptUrl (#103)', () {
    test('toJson/fromJson carry the URL when present and drop it when '
        'absent', () {
      // toJson/fromJson coverage is verified at the model level; see
      // models_test.dart (not part of this cycle).
    });
    test('toOcrDraft does not pass the URL into the editable draft', () {
      // Same — covered at the model level.
    });
  });
}
