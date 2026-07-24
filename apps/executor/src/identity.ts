import { createHash } from 'node:crypto';

export const createDefaultLeaseOwner = ({
  host,
  processId,
  nonce
}: {
  host: string;
  processId: number;
  nonce: string;
}) => {
  const hostDigest = createHash('sha256').update(host, 'utf8').digest('hex').slice(0, 16);
  const safeNonce = nonce.replaceAll(/[^A-Za-z0-9._:-]/g, '').slice(0, 80);
  return `executor-${hostDigest}-${processId.toString(36)}-${safeNonce || 'instance'}`;
};
