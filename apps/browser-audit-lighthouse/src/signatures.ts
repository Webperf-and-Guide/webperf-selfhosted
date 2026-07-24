import type { BrowserAuditWorkerRequest } from '@webperf/contracts';
import { createBrowserAuditSignature } from '@webperf/domain-core';

export const verifyBrowserAuditSignature = async (
  sharedSecret: string | undefined,
  request: BrowserAuditWorkerRequest
) => {
  if (!sharedSecret) {
    return false;
  }

  const expected = await createBrowserAuditSignature(sharedSecret, request);
  return constantTimeEqual(expected, request.signature);
};

const constantTimeEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    diff |= leftBytes[index]! ^ rightBytes[index]!;
  }

  return diff === 0;
};
