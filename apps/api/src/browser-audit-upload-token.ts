import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const tokenDomain = 'webperf-browser-audit-artifact-upload-v1';
const maximumTokenLength = 4_096;
const maximumTokenTtlMs = 3_600_000;

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
    signatureMatches = (
      candidateIsConfigured
      && suppliedSignature.byteLength === expected.byteLength
      && timingSafeEqual(suppliedSignature, expected)
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
  if (
    claims.version !== 'v1'
    || typeof claims.auditId !== 'string'
    || claims.auditId.length < 1
    || claims.auditId.length > 160
    || typeof claims.executionJobId !== 'string'
    || claims.executionJobId.length < 1
    || claims.executionJobId.length > 160
    || typeof claims.leaseOwner !== 'string'
    || claims.leaseOwner.length < 1
    || claims.leaseOwner.length > 200
    || !Number.isSafeInteger(claims.attemptCount)
    || (claims.attemptCount ?? 0) < 1
    || (claims.attemptCount ?? 0) > 20
    || !Number.isSafeInteger(claims.issuedAt)
    || !Number.isSafeInteger(claims.expiresAt)
    || !Number.isSafeInteger(claims.maxArtifactBytes)
    || (claims.maxArtifactBytes ?? 0) < 1
    || (claims.maxArtifactBytes ?? 0) > 250_000_000
    || typeof claims.nonce !== 'string'
    || !/^[a-f0-9-]{36}$/.test(claims.nonce)
  ) {
    throw new Error('Invalid upload token claims');
  }

  const issuedAt = claims.issuedAt as number;
  const expiresAt = claims.expiresAt as number;
  if (
    expiresAt <= issuedAt
    || expiresAt - issuedAt > maximumTokenTtlMs
    || issuedAt > now + 30_000
    || (requireLive && expiresAt <= now)
  ) {
    throw new Error('Invalid upload token lifetime');
  }
}
