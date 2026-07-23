import { describe, expect, test } from 'bun:test';
import { createCipheriv, hkdfSync } from 'node:crypto';
import { createStorageCrypto } from '../src/storage-crypto';

describe('SQLite payload encryption', () => {
  test('reports authenticated plaintext corruption without trying unrelated keys', () => {
    const currentSecret = 'storage-crypto-current-secret';
    const key = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(currentSecret, 'utf8'),
        Buffer.from('webperf-selfhosted/sqlite-encryption-salt/v1', 'utf8'),
        Buffer.from('webperf-selfhosted/sqlite-encryption-key/v1', 'utf8'),
        32
      )
    );
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('webperf-selfhosted/sqlite-payload/v2', 'utf8'));
    const ciphertext = Buffer.concat([cipher.update('{invalid-json', 'utf8'), cipher.final()]);
    const envelope = [
      'webperf:enc:v2',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url')
    ].join(':');
    const storageCrypto = createStorageCrypto({
      currentSecret,
      nextSecret: 'storage-crypto-next-secret'
    });

    expect(() => storageCrypto.parse(envelope)).toThrow(SyntaxError);
  });
});
