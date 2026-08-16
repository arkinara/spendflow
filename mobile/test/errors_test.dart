import 'package:flutter_test/flutter_test.dart';
import 'package:spendflow_mobile/api/errors.dart';

void main() {
  test('ApiError carries status, code and message', () {
    const error = ApiError(status: 422, code: 'over_cap', message: 'Nope');

    expect(error.status, 422);
    expect(error.code, 'over_cap');
    expect(error.message, 'Nope');
    expect(error, isA<ApiException>());
    expect(error.toString(), contains('over_cap'));
  });

  test('UnauthorizedError is an ApiException with the 401 signal', () {
    final error = UnauthorizedError('Session expired');

    expect(error, isA<ApiException>());
    expect(error.status, 401);
    expect(error.code, 'unauthorized');
    expect(error.message, 'Session expired');
  });

  test('NetworkError is an ApiException with no response status', () {
    final error = NetworkError('Connection refused');

    expect(error, isA<ApiException>());
    expect(error.status, 0);
    expect(error.code, 'network_error');
  });
}
