import { describe, expect, test } from 'bun:test';
import { parseSelfhostApiVars } from './selfhost';
import { parseSelfhostConsoleVars } from './selfhost-console';
import { parseSelfhostSchedulerVars } from './selfhost-scheduler';
import { parseSelfhostExecutorVars } from './selfhost-executor';

const requiredApiSecrets = {
  SELFHOST_ADMIN_TOKEN: 'test-admin-token-value',
  SELFHOST_INTERNAL_SECRET: 'test-internal-secret-value'
};
const executionSecrets = {
  PROBE_SHARED_SECRET: 'test-probe-secret-value',
  BROWSER_AUDIT_SHARED_SECRET: 'test-browser-secret-value'
};

describe('strict self-host configuration', () => {
  test('requires every production API secret and does not invent fallbacks', () => {
    expect(() => parseSelfhostApiVars({})).toThrow();
    expect(() =>
      parseSelfhostApiVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET
      })
    ).toThrow('administrator token');
    expect(parseSelfhostApiVars(requiredApiSecrets)).toMatchObject({
      ...requiredApiSecrets,
      SELFHOST_MIGRATION_BACKUP: false,
      SELFHOST_ARTIFACTS_PATH: './data/artifacts',
      SELFHOST_MAX_ARTIFACT_BYTES: 25_000_000,
      SELFHOST_ARTIFACT_UPLOAD_TTL_SECONDS: 900
    });
    expect(parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_MIGRATION_BACKUP: 'true'
    }).SELFHOST_MIGRATION_BACKUP).toBe(true);
    expect(parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_MIGRATION_BACKUP: ' TRUE '
    }).SELFHOST_MIGRATION_BACKUP).toBe(true);
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_ARTIFACT_UPLOAD_BASE_URL: 'https://operator:secret@api.example.test/path'
    })).toThrow('Artifact upload base URL');
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_MAX_ARTIFACT_BYTES: '250000001'
    })).toThrow();
  });

  test('Issue #14 Phase 1: parses single-region runtime identity and probe origin', () => {
    // Defaults: id `local`, label resolves to id at consumption time, probe origin loopback.
    const defaults = parseSelfhostApiVars(requiredApiSecrets);
    expect(defaults.SELFHOST_REGION_ID).toBe('local');
    expect(defaults.SELFHOST_REGION_LABEL).toBeUndefined();
    expect(defaults.SELFHOST_PROBE_BASE_URL).toBe('http://127.0.0.1:8080');

    // Operator-chosen generic region ids stay accepted.
    const configured = parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_REGION_ID: 'kr-seoul-office',
      SELFHOST_REGION_LABEL: 'Seoul office runtime',
      SELFHOST_PROBE_BASE_URL: 'http://probe:8080'
    });
    expect(configured.SELFHOST_REGION_ID).toBe('kr-seoul-office');
    expect(configured.SELFHOST_REGION_LABEL).toBe('Seoul office runtime');
    expect(configured.SELFHOST_PROBE_BASE_URL).toBe('http://probe:8080');
  });

  test('Issue #14 Phase 1: rejects invalid region ids and probe origins', () => {
    // region id must be lowercase ascii letters/digits/hyphens, anchored.
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_REGION_ID: 'Tokyo'
    })).toThrow();
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_REGION_ID: 'has space'
    })).toThrow();
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_REGION_ID: '-leading-hyphen'
    })).toThrow();
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_REGION_ID: 'trailing-hyphen-'
    })).toThrow();
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_REGION_ID: 'a'.repeat(65)
    })).toThrow();

    // probe origin must be a credential-free HTTP(S) origin.
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_PROBE_BASE_URL: 'https://operator:secret@probe.internal/'
    })).toThrow('credential-free');
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_PROBE_BASE_URL: 'http://probe.internal/measure'
    })).toThrow();
    expect(() => parseSelfhostApiVars({
      ...requiredApiSecrets,
      SELFHOST_PROBE_BASE_URL: 'ftp://probe.internal/'
    })).toThrow();
  });

  test('Issue #14 Phase 4: requires isolated credentials in regional runtime mode', () => {
    expect(() => parseSelfhostApiVars({
      SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
      SELFHOST_RUNTIME_MODE: 'regional-runtime'
    })).toThrow('dedicated shared secret');

    expect(parseSelfhostApiVars({
      SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
      SELFHOST_RUNTIME_MODE: 'regional-runtime',
      REGIONAL_RUNTIME_SHARED_SECRET: 'regional-runtime-current-secret',
      REGIONAL_RUNTIME_SHARED_SECRET_NEXT: 'regional-runtime-next-secret',
      WEBPERF_RUNTIME_VERSION: '0.3.0',
      WEBPERF_RUNTIME_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
      WEBPERF_PROBE_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`
    })).toMatchObject({
      SELFHOST_RUNTIME_MODE: 'regional-runtime',
      REGIONAL_RUNTIME_SHARED_SECRET: 'regional-runtime-current-secret',
      REGIONAL_RUNTIME_SHARED_SECRET_NEXT: 'regional-runtime-next-secret',
      WEBPERF_RUNTIME_VERSION: '0.3.0'
    });

    expect(() => parseSelfhostApiVars({
      SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
      SELFHOST_RUNTIME_MODE: 'regional-runtime',
      REGIONAL_RUNTIME_SHARED_SECRET: 'regional-runtime-current-secret',
      WEBPERF_RUNTIME_IMAGE_DIGEST: 'sha256:not-a-digest'
    })).toThrow();
  });

  test('requires server-side console, scheduler, and executor credentials', () => {
    expect(() => parseSelfhostConsoleVars({})).toThrow();
    expect(() => parseSelfhostSchedulerVars({})).toThrow();
    expect(() => parseSelfhostExecutorVars({})).toThrow();
    expect(
      parseSelfhostConsoleVars({ SELFHOST_ADMIN_TOKEN: requiredApiSecrets.SELFHOST_ADMIN_TOKEN })
        .CONTROL_BASE_URL
    ).toBe('http://127.0.0.1:8788');
    expect(() => parseSelfhostConsoleVars({
      SELFHOST_ADMIN_TOKEN: requiredApiSecrets.SELFHOST_ADMIN_TOKEN,
      CONTROL_BASE_URL: 'https://operator:secret@api.example.test/path?token=x'
    })).toThrow('without path');
    expect(
      parseSelfhostSchedulerVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET
      }).SELFHOST_SCHEDULER_API_BASE_URL
    ).toBe('http://127.0.0.1:8788');
    expect(() => parseSelfhostSchedulerVars({
      SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
      SELFHOST_SCHEDULER_API_BASE_URL: 'https://operator:secret@api.example.test/path?token=x'
    })).toThrow('without path');
    expect(
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        PROBE_SHARED_SECRET: executionSecrets.PROBE_SHARED_SECRET
      })
    ).toMatchObject({
      SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP: false,
      SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP: false,
      SELFHOST_EXECUTOR_ALLOW_INSECURE_PROBE_HTTP: false,
      SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP: false,
      SELFHOST_EXECUTOR_LEASE_DURATION_MS: 60_000,
      SELFHOST_EXECUTOR_MAX_EXECUTION_MS: 900_000
    });
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        PROBE_SHARED_SECRET: executionSecrets.PROBE_SHARED_SECRET,
        SELFHOST_BROWSER_AUDIT_BASE_URL: 'http://browser-audit:8080',
        SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP: 'true'
      })
    ).toThrow('requires its shared secret');
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_EXECUTOR_LEASE_DURATION_MS: 10_000,
        SELFHOST_EXECUTOR_HEARTBEAT_INTERVAL_MS: 5_000
      })
    ).toThrow('heartbeat interval');
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_EXECUTOR_API_BASE_URL: 'https://operator:secret@api.example.test?token=secret'
      })
    ).toThrow('without path');
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_EXECUTOR_API_BASE_URL: 'http://api.internal:8788'
      })
    ).toThrow('explicit insecure opt-in');
    expect(
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_EXECUTOR_API_BASE_URL: 'http://api.internal:8788',
        SELFHOST_EXECUTOR_ALLOW_INSECURE_API_HTTP: 'true'
      }).SELFHOST_EXECUTOR_API_BASE_URL
    ).toBe('http://api.internal:8788');
    expect(() =>
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_BROWSER_AUDIT_BASE_URL: 'http://browser-audit:8080'
      })
    ).toThrow('allowed credential-free origin');
    expect(
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_BROWSER_AUDIT_BASE_URL: 'http://browser-audit:8080',
        SELFHOST_EXECUTOR_ALLOW_INSECURE_BROWSER_AUDIT_HTTP: 'true'
      }).SELFHOST_BROWSER_AUDIT_BASE_URL
    ).toBe('http://browser-audit:8080');
    expect(
      parseSelfhostExecutorVars({
        SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
        ...executionSecrets,
        SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP: 'true'
      }).SELFHOST_EXECUTOR_ALLOW_INSECURE_WEBHOOK_HTTP
    ).toBe(true);
  });

  test('Issue #14 Phase 1: executor accepts the single-region probe origin', () => {
    const base = {
      SELFHOST_INTERNAL_SECRET: requiredApiSecrets.SELFHOST_INTERNAL_SECRET,
      ...executionSecrets
    };
    expect(parseSelfhostExecutorVars(base).SELFHOST_PROBE_BASE_URL).toBe('http://127.0.0.1:8080');
    expect(parseSelfhostExecutorVars({
      ...base,
      SELFHOST_PROBE_BASE_URL: 'http://probe:8080'
    }).SELFHOST_PROBE_BASE_URL).toBe('http://probe:8080');
    // Same credential-free origin discipline as the API parser.
    expect(() => parseSelfhostExecutorVars({
      ...base,
      SELFHOST_PROBE_BASE_URL: 'https://operator:secret@probe.internal/'
    })).toThrow('credential-free');
    expect(() => parseSelfhostExecutorVars({
      ...base,
      SELFHOST_PROBE_BASE_URL: 'http://probe.internal/measure'
    })).toThrow();
  });
});
