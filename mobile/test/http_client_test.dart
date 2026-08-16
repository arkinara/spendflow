import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spendflow_mobile/api/errors.dart';
import 'package:spendflow_mobile/api/http_client.dart';

Uri _base = Uri.parse('http://be.test');

HttpClient _sut(http.Client mock) => HttpClient(baseUrl: _base, inner: mock);

void main() {
  test('a 2xx JSON response is decoded', () async {
    final sut = _sut(MockClient((request) async {
      return http.Response(
        '{"user":{"id":"u1","email":"a@b.c"}}',
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    }));

    final data = await sut.request(method: 'GET', path: '/api/me');

    expect(data, isA<Map<String, dynamic>>());
    expect((data as Map<String, dynamic>)['user'], isA<Map<String, dynamic>>());
  });

  test('a 2xx non-JSON response resolves to the raw body text', () async {
    final sut = _sut(MockClient((request) async => http.Response('pong', 200)));

    final data = await sut.request(method: 'GET', path: '/health');

    expect(data, 'pong');
  });

  test('a 401 throws UnauthorizedError and fires the registered handler',
      () async {
    var fired = 0;
    final sut = _sut(MockClient((request) async => http.Response('{}', 401)))
      ..setAuth401Handler(() => fired += 1);

    await expectLater(
      sut.request(method: 'GET', path: '/api/me'),
      throwsA(isA<UnauthorizedError>()),
    );
    expect(fired, 1);
  });

  test('a 500 with the error envelope throws ApiError with its code+message',
      () async {
    final sut = _sut(MockClient((request) async {
      return http.Response(
        jsonEncode(<String, dynamic>{
          'error': <String, dynamic>{'code': 'boom', 'message': 'It broke'},
        }),
        500,
        headers: {'content-type': 'application/json'},
      );
    }));

    try {
      await sut.request(method: 'GET', path: '/api/claims');
      fail('should have thrown');
    } on ApiError catch (error) {
      expect(error.status, 500);
      expect(error.code, 'boom');
      expect(error.message, 'It broke');
    }
  });

  test('a connection failure surfaces as NetworkError, not a raw exception',
      () async {
    final sut = _sut(MockClient((request) async {
      throw http.ClientException('Connection refused', request.url);
    }));

    await expectLater(
      sut.request(method: 'GET', path: '/api/me'),
      throwsA(isA<NetworkError>()),
    );
  });

  test('a timeout surfaces as NetworkError', () async {
    final sut = _sut(MockClient((request) async {
      await Future<void>.delayed(const Duration(seconds: 2));
      return http.Response('{}', 200);
    }));

    await expectLater(
      sut.request(
        method: 'GET',
        path: '/api/me',
        timeout: const Duration(milliseconds: 50),
      ),
      throwsA(isA<NetworkError>()),
    );
  });

  test('query params are encoded onto the URL', () async {
    Uri? seen;
    final sut = _sut(MockClient((request) async {
      seen = request.url;
      return http.Response('{}', 200);
    }));

    await sut.request(
      method: 'GET',
      path: '/api/claims',
      query: <String, String>{'status': 'open', 'q': 'café & co'},
    );

    expect(seen!.queryParameters['status'], 'open');
    expect(seen!.queryParameters['q'], 'café & co');
  });

  test('a POST body is JSON-serialized with the JSON content type', () async {
    http.Request? seen;
    final sut = _sut(MockClient((request) async {
      seen = request;
      return http.Response('{}', 200);
    }));

    await sut.request(
      method: 'POST',
      path: '/api/auth/sign-in/email',
      body: <String, String>{'email': 'a@b.c', 'password': 'pw'},
    );

    expect(seen!.headers['content-type'], 'application/json');
    expect(jsonDecode(seen!.body),
        <String, String>{'email': 'a@b.c', 'password': 'pw'});
  });

  test('a GET sends no JSON content type', () async {
    http.Request? seen;
    final sut = _sut(MockClient((request) async {
      seen = request;
      return http.Response('{}', 200);
    }));

    await sut.request(method: 'GET', path: '/api/me');

    expect(seen!.headers.containsKey('content-type'), isFalse);
    expect(seen!.body, isEmpty);
  });
}
