import { describe, expect, test } from 'bun:test';
import { validateBrowserRequestUrl } from './network-policy';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('browser audit network policy', () => {
  test('accepts public HTTP targets', async () => {
    const result = await validateBrowserRequestUrl('https://example.com/path', {
      lookupHost: publicLookup
    });
    expect(result.hostname).toBe('example.com');
  });

  test('blocks non-HTTP schemes, embedded credentials, and alternate ports', async () => {
    await expect(validateBrowserRequestUrl('file:///etc/passwd')).rejects.toThrow('scheme');
    await expect(validateBrowserRequestUrl('https://user:pass@example.com')).rejects.toThrow('Credentials');
    await expect(validateBrowserRequestUrl('https://example.com:8443')).rejects.toThrow('ports 80 and 443');
  });

  test('blocks local hostnames and private DNS answers', async () => {
    await expect(validateBrowserRequestUrl('http://metadata.google.internal')).rejects.toThrow('blocked');
    await expect(
      validateBrowserRequestUrl('https://example.com', {
        lookupHost: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '169.254.169.254', family: 4 }
        ]
      })
    ).rejects.toThrow('private, local, metadata, or reserved');
  });

  test('blocks private IPv4, IPv6, and mapped IPv4 literals', async () => {
    await expect(validateBrowserRequestUrl('http://127.0.0.1')).rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[::1]')).rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[::ffff:127.0.0.1]')).rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[::ffff:7f00:1]')).rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[::192.168.1.1]')).rejects.toThrow('private');
    await expect(
      validateBrowserRequestUrl('https://example.com', {
        lookupHost: async () => [{
          address: '0:0:0:0:0:ffff:169.254.169.254',
          family: 6
        }]
      })
    ).rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[64:ff9b::a9fe:a9fe]'))
      .rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]'))
      .rejects.toThrow('private');
    await expect(validateBrowserRequestUrl('http://[2002:a9fe:a9fe::1]'))
      .rejects.toThrow('private');
  });

  test('bounds DNS resolution time', async () => {
    await expect(validateBrowserRequestUrl('https://slow.example', {
      lookupHost: async () => new Promise(() => undefined),
      lookupTimeoutMs: 10
    })).rejects.toThrow('could not be resolved');
  });

  test('allows an operator to opt in an exact private host', async () => {
    const result = await validateBrowserRequestUrl('http://service.internal', {
      allowlist: ['service.internal'],
      lookupHost: async () => [{ address: '10.0.0.4', family: 4 }]
    });
    expect(result.hostname).toBe('service.internal');
  });
});
