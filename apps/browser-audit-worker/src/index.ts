import {
  browserAuditCapabilitiesSchema,
  browserAuditWorkerRequestSchema,
  browserAuditWorkerResponseSchema
} from '@webperf/contracts';
import { launchBrowser, runBrowserAudit } from './audit';
import { buildCapabilities, buildStartupCheck } from './capabilities';
import { getConfig } from './config';
import { verifyBrowserAuditSignature } from './signatures';

const json = (payload: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {})
    }
  });

const config = getConfig();
const startupCheck = await runStartupCheck();
const capabilities = browserAuditCapabilitiesSchema.parse(buildCapabilities(startupCheck.toolchain));
let activeExecutionId: string | null = null;

Bun.serve({
  hostname: config.host,
  port: config.port,
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(
        {
          ok: startupCheck.ok,
          checkedAt: startupCheck.checkedAt,
          errors: startupCheck.errors,
          activeExecutionId
        },
        { status: startupCheck.ok ? 200 : 503 }
      );
    }

    if (request.method === 'GET' && url.pathname === '/capabilities') {
      return json({
        ...capabilities,
        healthy: startupCheck.ok,
        checkedAt: startupCheck.checkedAt
      });
    }

    if (request.method === 'POST' && url.pathname === '/audit') {
      let body: unknown;

      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const parsed = browserAuditWorkerRequestSchema.safeParse(body);

      if (!parsed.success) {
        return json(
          {
            error: 'Invalid browser audit request',
            issues: parsed.error.flatten()
          },
          { status: 400 }
        );
      }

      if (!startupCheck.ok) {
        return json(
          {
            error: 'Browser audit worker is not healthy',
            issues: startupCheck.errors
          },
          { status: 503 }
        );
      }

      const currentSecretOkay = await verifyBrowserAuditSignature(config.sharedSecret, parsed.data);
      const nextSecretOkay = !currentSecretOkay && (await verifyBrowserAuditSignature(config.sharedSecretNext, parsed.data));

      if (!currentSecretOkay && !nextSecretOkay) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      if (activeExecutionId) {
        return json(
          {
            error: 'Worker is busy',
            activeExecutionId
          },
          { status: 409 }
        );
      }

      activeExecutionId = parsed.data.executionId;

      try {
        const result = await runBrowserAudit({
          config,
          input: parsed.data,
          toolchain: capabilities.toolchain,
          capabilities
        });

        return json(
          browserAuditWorkerResponseSchema.parse({
            executionId: parsed.data.executionId,
            status: 'succeeded',
            result,
            error: null
          })
        );
      } catch (error) {
        return json(
          browserAuditWorkerResponseSchema.parse({
            executionId: parsed.data.executionId,
            status: 'failed',
            result: null,
            error: error instanceof Error ? error.message : 'Browser audit failed'
          }),
          { status: 500 }
        );
      } finally {
        activeExecutionId = null;
      }
    }

    return json({ error: 'Not found' }, { status: 404 });
  }
});

console.log(
  JSON.stringify({
    service: 'browser-audit-worker',
    host: config.host,
    port: config.port,
    chromeExecutablePath: config.chromeExecutablePath,
    healthy: startupCheck.ok
  })
);

async function runStartupCheck() {
  const result = await buildStartupCheck(config);

  if (config.chromeExecutablePath) {
    try {
      const browser = await launchBrowser(config);
      await browser.close();
    } catch (error) {
      result.errors.push(error instanceof Error ? `Chrome launch smoke failed: ${error.message}` : 'Chrome launch smoke failed');
      result.ok = false;
    }
  }

  return {
    ...result,
    ok: result.errors.length === 0
  };
}
