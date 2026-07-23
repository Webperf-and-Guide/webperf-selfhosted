import { describe, expect, test } from 'bun:test';
import { JsonBodyTooLargeError, readBoundedJson } from '../src/json-body';

describe('bounded JSON request bodies', () => {
  test('parses a body at the byte limit', async () => {
    const body = JSON.stringify({ value: '안녕' });
    const byteSize = new TextEncoder().encode(body).byteLength;
    const request = new Request('http://localhost/', { method: 'POST', body });

    await expect(readBoundedJson(request, byteSize)).resolves.toEqual({ value: '안녕' });
  });

  test('rejects declared and streamed bodies above the limit', async () => {
    const declared = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-length': '9' },
      body: '{}'
    });
    await expect(readBoundedJson(declared, 8)).rejects.toBeInstanceOf(
      JsonBodyTooLargeError
    );

    const streamed = new Request('http://localhost/', {
      method: 'POST',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"'));
          controller.enqueue(new TextEncoder().encode('too large"}'));
          controller.close();
        }
      })
    });
    await expect(readBoundedJson(streamed, 12)).rejects.toBeInstanceOf(
      JsonBodyTooLargeError
    );
  });

  test('rejects malformed JSON and invalid limits', async () => {
    await expect(readBoundedJson(
      new Request('http://localhost/', { method: 'POST', body: '{' }),
      10
    )).rejects.toBeInstanceOf(SyntaxError);
    await expect(readBoundedJson(
      new Request('http://localhost/', { method: 'POST', body: '{}' }),
      0
    )).rejects.toThrow('positive integer');
  });
});
