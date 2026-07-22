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
  });

  test('allows an operator to opt in an exact private host', async () => {
    const result = await validateBrowserRequestUrl('http://service.internal', {
      allowlist: ['service.internal']
    });
    expect(result.hostname).toBe('service.internal');
  });
});
