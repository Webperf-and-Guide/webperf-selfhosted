import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto';

const envelopePrefix = 'webperf:enc:v1';
const associatedData = Buffer.from('webperf-selfhosted/sqlite-payload/v1', 'utf8');

export type StorageCrypto = {
  stringify(value: unknown): string;
  parse(value: string): unknown;
};

export const createStorageCrypto = ({
  currentSecret,
  nextSecret
}: {
  currentSecret: string;
  nextSecret?: string;
}): StorageCrypto => {
  const currentKey = deriveKey(currentSecret);
  const decryptionKeys = [currentKey, ...(nextSecret ? [deriveKey(nextSecret)] : [])];

  return {
    stringify(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', currentKey, iv);
      cipher.setAAD(associatedData);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();
      return [envelopePrefix, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
    },
    parse(value) {
      if (!value.startsWith(`${envelopePrefix}:`)) {
        return JSON.parse(value);
      }

      const envelope = parseEnvelope(value);
      let lastError: unknown;

      for (const key of decryptionKeys) {
        try {
          const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv);
          decipher.setAAD(associatedData);
          decipher.setAuthTag(envelope.tag);
          const plaintext = Buffer.concat([
            decipher.update(envelope.ciphertext),
            decipher.final()
          ]).toString('utf8');
          return JSON.parse(plaintext);
        } catch (error) {
          lastError = error;
        }
      }

      throw new Error('Unable to decrypt persisted payload', { cause: lastError });
    }
  };
};

const deriveKey = (secret: string) => createHash('sha256').update(secret, 'utf8').digest();

const parseEnvelope = (value: string) => {
  const parts = value.split(':');

  if (parts.length !== 6 || parts.slice(0, 3).join(':') !== envelopePrefix) {
    throw new Error('Invalid encrypted payload envelope');
  }

  const iv = Buffer.from(parts[3] ?? '', 'base64url');
  const tag = Buffer.from(parts[4] ?? '', 'base64url');
  const ciphertext = Buffer.from(parts[5] ?? '', 'base64url');

  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted payload envelope');
  }

  return { iv, tag, ciphertext };
};
