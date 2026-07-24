import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const tokenDomain = 'webperf-browser-audit-artifact-upload-v1';
const maximumTokenLength = 4_096;
const maximumTokenTtlMs = 3_600_000;
const maximumAuditIdLength = 160;
const maximumExecutionJobIdLength = 160;
const maximumLeaseOwnerLength = 200;
const maximumAttemptCount = 20;
const maximumArtifactBytes = 250_000_000;
const allowedClockSkewMs = 30_000;
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BrowserAuditUploadTokenClaims = {
  version: 'v1';
  auditId: string;
  executionJobId: string;
  leaseOwner: string;
  attemptCount: number;
  issuedAt: number;
  expiresAt: number;
  maxArtifactBytes: number;
  nonce: string;
};

export const issueBrowserAuditUploadToken = ({
  secret,
  auditId,
  executionJobId,
  leaseOwner,
  attemptCount,
  expiresAt,
  maxArtifactBytes,
  now = new Date()
}: {
  secret: string;
  auditId: string;
  executionJobId: string;
  leaseOwner: string;
  attemptCount: number;
  expiresAt: Date;
  maxArtifactBytes: number;
  now?: Date;
}) => {
  if (secret.length < 16) {
    throw new Error('Artifact upload signing secret must contain at least 16 characters');
  }

  const claims: BrowserAuditUploadTokenClaims = {
    version: 'v1',
    auditId,
    executionJobId,
    leaseOwner,
    attemptCount,
    issuedAt: now.getTime(),
    expiresAt: expiresAt.getTime(),
    maxArtifactBytes,
    // This signed nonce correlates grants in diagnostics; it is not a one-time
    // replay token. Active lease/attempt validation and artifact limits bound replays.
    nonce: randomUUID()
  };
  assertClaims(claims, now.getTime(), false);
  const encodedClaims = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = sign(encodedClaims, secret).toString('base64url');
  return `${encodedClaims}.${signature}`;
};

export const verifyBrowserAuditUploadToken = ({
  token,
  secrets,
  now = new Date()
}: {
  token: string;
  secrets: Array<string | undefined>;
  now?: Date;
}): BrowserAuditUploadTokenClaims | null => {
  if (token.length === 0 || token.length > maximumTokenLength) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  let suppliedSignature: Buffer;

  try {
    suppliedSignature = Buffer.from(parts[1], 'base64url');
  } catch {
    return null;
  }

  let signatureMatches = false;
  for (const secret of secrets) {
    const candidateIsConfigured = typeof secret === 'string' && secret.length > 0;
    const expected = sign(
      parts[0],
      candidateIsConfigured ? secret : `${tokenDomain}-unconfigured-key`
    );
    const suppliedHasExpectedLength = suppliedSignature.byteLength === expected.byteLength;
    const suppliedToCompare = suppliedHasExpectedLength
      ? suppliedSignature
      : Buffer.alloc(expected.byteLength);
    const candidateMatches = timingSafeEqual(suppliedToCompare, expected);
    signatureMatches = (
      candidateIsConfigured && suppliedHasExpectedLength && candidateMatches
    ) || signatureMatches;
  }

  if (!signatureMatches) {
    return null;
  }

  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as unknown;
    assertClaims(claims, now.getTime(), true);
    return claims;
  } catch {
    return null;
  }
};

const sign = (encodedClaims: string, secret: string) =>
  createHmac('sha256', secret)
    .update(tokenDomain, 'utf8')
    .update('\n', 'utf8')
    .update(encodedClaims, 'utf8')
    .digest();

function assertClaims(
  value: unknown,
  now: number,
  requireLive: boolean
): asserts value is BrowserAuditUploadTokenClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid upload token claims');
  }

  const claims = value as Partial<BrowserAuditUploadTokenClaims>;
  if (claims.version !== 'v1') {
    throw new Error('Invalid upload token version');
  }

  assertBoundedStringClaim(claims.auditId, maximumAuditIdLength, 'audit ID');
  assertBoundedStringClaim(
    claims.executionJobId,
    maximumExecutionJobIdLength,
    'execution job ID'
  );
  assertBoundedStringClaim(claims.leaseOwner, maximumLeaseOwnerLength, 'lease owner');
  assertBoundedIntegerClaim(claims.attemptCount, maximumAttemptCount, 'attempt count');
  assertSafeIntegerClaim(claims.issuedAt, 'issued-at time');
  assertSafeIntegerClaim(claims.expiresAt, 'expiry time');
  assertBoundedIntegerClaim(
    claims.maxArtifactBytes,
    maximumArtifactBytes,
    'artifact byte limit'
  );
  if (typeof claims.nonce !== 'string' || !noncePattern.test(claims.nonce)) {
    throw new Error('Invalid upload token nonce');
  }

  const issuedAt = claims.issuedAt;
  const expiresAt = claims.expiresAt;
  if (
    expiresAt <= issuedAt
    || expiresAt - issuedAt > maximumTokenTtlMs
    || issuedAt > now + allowedClockSkewMs
    || (requireLive && expiresAt <= now)
  ) {
    throw new Error('Invalid upload token lifetime');
  }
}

function assertBoundedStringClaim(
  value: unknown,
  maximumLength: number,
  label: string
): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength) {
    throw new Error(`Invalid upload token ${label}`);
  }
}

function assertSafeIntegerClaim(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid upload token ${label}`);
  }
}

function assertBoundedIntegerClaim(
  value: unknown,
  maximumValue: number,
  label: string
): asserts value is number {
  assertSafeIntegerClaim(value, label);
  if (value < 1 || value > maximumValue) {
    throw new Error(`Invalid upload token ${label}`);
  }
}
