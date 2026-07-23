import { describe, expect, test } from 'bun:test';
import { buildChromeLaunchArgs } from './audit';

describe('Lighthouse Chrome launch policy', () => {
  test('forces browser traffic through the pinned proxy', () => {
    const args = buildChromeLaunchArgs(
      { allowNoSandbox: false },
      'http://127.0.0.1:41234'
    );

    expect(args).toContain('--proxy-server=http://127.0.0.1:41234');
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
    expect(args).toContain('--disable-quic');
    expect(args).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(args).not.toContain('--no-sandbox');
  });

  test('adds no-sandbox only for the explicit degraded mode', () => {
    expect(buildChromeLaunchArgs({ allowNoSandbox: true })).toContain('--no-sandbox');
    expect(buildChromeLaunchArgs({ allowNoSandbox: false })).not.toContain('--no-sandbox');
  });
});
