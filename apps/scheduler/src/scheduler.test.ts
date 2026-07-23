import { describe, expect, test } from 'bun:test';
import {
  dispatchScheduledChecks,
  runScheduler,
  SchedulerDispatchError,
  type SchedulerLogger
} from './scheduler';

const dispatchPayload = {
  dispatchedAt: '2026-07-22T00:00:00.000Z',
  triggeredCount: 1,
  triggeredProfiles: [{
    profileId: 'check_scheduled',
    jobIds: ['job_tokyo', 'job_singapore'],
    nextRunAt: '2026-07-22T00:05:00.000Z'
  }]
};

describe('self-host scheduler boundary', () => {
  test('only posts an authenticated request to the due-check dispatch endpoint', async () => {
    const requests: Request[] = [];
    const result = await dispatchScheduledChecks({
      apiBaseUrl: 'https://api.example.test',
      internalSecret: 'scheduler-internal-secret',
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(dispatchPayload);
      }
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.example.test/v1/scheduler/dispatch');
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.headers.get('authorization'))
      .toBe('Bearer scheduler-internal-secret');
    expect(await requests[0]?.text()).toBe('');
    expect(result.payload).toEqual(dispatchPayload);
    expect(result.createdJobCount).toBe(2);
  });

  test('does not reflect an API response body or credential into failures', async () => {
    const secret = 'scheduler-secret-must-not-leak';
    let caught: unknown;

    try {
      await dispatchScheduledChecks({
        apiBaseUrl: 'https://api.example.test',
        internalSecret: secret,
        fetchImpl: async () => new Response(
          `raw API error containing ${secret}`,
          { status: 503 }
        )
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SchedulerDispatchError);
    expect(caught).toMatchObject({ code: 'request_failed', status: 503 });
    expect(String(caught)).not.toContain(secret);
    expect(String(caught)).not.toContain('raw API error');
  });

  test('bounds a dispatch when the API never responds', async () => {
    const observed: { requestSignal?: AbortSignal } = {};
    let caught: unknown;

    try {
      await dispatchScheduledChecks({
        apiBaseUrl: 'https://api.example.test',
        internalSecret: 'scheduler-internal-secret',
        requestTimeoutMs: 10,
        fetchImpl: async (_input, init) => {
          const requestSignal = init?.signal;

          if (!requestSignal) {
            throw new Error('Expected the scheduler request signal');
          }

          observed.requestSignal = requestSignal;

          return await new Promise<Response>((_resolve, reject) => {
            requestSignal.addEventListener(
              'abort',
              () => reject(requestSignal.reason),
              { once: true }
            );
          });
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(observed.requestSignal?.aborted).toBe(true);
    expect(caught).toBeInstanceOf(SchedulerDispatchError);
    expect(caught).toMatchObject({ code: 'request_timeout', status: null });
  });

  test('bounds response body reads while preserving the HTTP status', async () => {
    let caught: unknown;

    try {
      await dispatchScheduledChecks({
        apiBaseUrl: 'https://api.example.test',
        internalSecret: 'scheduler-internal-secret',
        requestTimeoutMs: 10,
        fetchImpl: async () => new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"triggeredCount":'));
          }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SchedulerDispatchError);
    expect(caught).toMatchObject({ code: 'request_timeout', status: 200 });
  });

  test('normalizes non-Error shutdown reasons without reflecting them', async () => {
    const controller = new AbortController();
    const rawReason = 'operator-secret-shutdown-reason';
    let caught: unknown;

    try {
      await dispatchScheduledChecks({
        apiBaseUrl: 'https://api.example.test',
        internalSecret: 'scheduler-internal-secret',
        signal: controller.signal,
        fetchImpl: async (_input, init) => {
          const requestSignal = init?.signal;
          if (!requestSignal) {
            throw new Error('Expected the scheduler request signal');
          }

          return await new Promise<Response>((_resolve, reject) => {
            requestSignal.addEventListener(
              'abort',
              () => reject(requestSignal.reason),
              { once: true }
            );
            controller.abort(rawReason);
          });
        }
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ name: 'AbortError' });
    expect(String(caught)).not.toContain(rawReason);
  });

  test('rejects a credential-bearing or pathful API base URL before fetch', async () => {
    let fetchCalled = false;

    await expect(dispatchScheduledChecks({
      apiBaseUrl: 'https://operator:secret@api.example.test/path?token=x',
      internalSecret: 'scheduler-internal-secret',
      fetchImpl: async () => {
        fetchCalled = true;
        return Response.json(dispatchPayload);
      }
    })).rejects.toThrow('credential-free');
    expect(fetchCalled).toBe(false);
  });

  test('stops without another claim cycle when shutdown aborts the current cycle', async () => {
    const controller = new AbortController();
    const events: Record<string, unknown>[] = [];
    const logger: SchedulerLogger = {
      info: (event) => events.push(event),
      error: (event) => events.push(event)
    };
    let dispatchCount = 0;

    await runScheduler({
      dispatch: async () => {
        dispatchCount += 1;
        controller.abort();
        return { payload: dispatchPayload, createdJobCount: 2 };
      },
      pollIntervalMs: 60_000,
      signal: controller.signal,
      logger
    });

    expect(dispatchCount).toBe(1);
    expect(events).toEqual([]);
  });

  test('backs off consecutive failures and resets after success', async () => {
    const controller = new AbortController();
    const delays: number[] = [];
    const logger: SchedulerLogger = { info: () => {}, error: () => {} };
    let dispatchCount = 0;

    await runScheduler({
      dispatch: async () => {
        dispatchCount += 1;

        if (dispatchCount <= 2) {
          throw new SchedulerDispatchError('request_failed', 503);
        }

        if (dispatchCount === 4) {
          controller.abort();
        }

        return { payload: dispatchPayload, createdJobCount: 2 };
      },
      pollIntervalMs: 1_000,
      maxBackoffMs: 3_000,
      signal: controller.signal,
      logger,
      wait: async (durationMs) => {
        delays.push(durationMs);
      }
    });

    expect(dispatchCount).toBe(4);
    expect(delays).toEqual([2_000, 3_000, 1_000]);
  });
});
