import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes
} from 'node:crypto';

const currentEnvelopePrefix = 'webperf:enc:v2';
const legacyEnvelopePrefix = 'webperf:enc:v1';
const currentAssociatedData = Buffer.from('webperf-selfhosted/sqlite-payload/v2', 'utf8');
const legacyAssociatedData = Buffer.from('webperf-selfhosted/sqlite-payload/v1', 'utf8');

export type StorageCrypto = {
  stringify(value: unknown): string;
  parse(value: string, options?: { allowPlaintext?: boolean }): unknown;
};

export class UnencryptedPersistedPayloadError extends Error {
  override readonly name: string = 'UnencryptedPersistedPayloadError';

  constructor() {
    super('Refusing to parse an unencrypted persisted payload');
  }
}

export class InvalidEncryptedPayloadEnvelopeError extends Error {
  override readonly name: string = 'InvalidEncryptedPayloadEnvelopeError';

  constructor() {
    super('Invalid encrypted payload envelope');
  }
}

export const createStorageCrypto = ({
  currentSecret,
  nextSecret
}: {
  currentSecret: string;
  nextSecret?: string;
}): StorageCrypto => {
  assertStorageSecret(currentSecret, 'current');
  if (nextSecret !== undefined) {
    assertStorageSecret(nextSecret, 'next');
  }

  const currentKey = deriveKey(currentSecret);
  const decryptionKeys = [currentKey, ...(nextSecret ? [deriveKey(nextSecret)] : [])];
  const legacyDecryptionKeys = [deriveLegacyKey(currentSecret), ...(nextSecret ? [deriveLegacyKey(nextSecret)] : [])];

  return {
    stringify(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', currentKey, iv);
      cipher.setAAD(currentAssociatedData);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();
      return [currentEnvelopePrefix, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
    },
    parse(value, options = {}) {
      if (!isEncryptedEnvelope(value)) {
        if (!options.allowPlaintext) {
          throw new UnencryptedPersistedPayloadError();
        }
        return JSON.parse(value);
      }

      const envelope = parseEnvelope(value);
      const keys = envelope.prefix === currentEnvelopePrefix ? decryptionKeys : legacyDecryptionKeys;
      const associatedData = envelope.prefix === currentEnvelopePrefix
        ? currentAssociatedData
        : legacyAssociatedData;
      const errors: unknown[] = [];

      for (const key of keys) {
        let plaintext: string;

        try {
          const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv);
          decipher.setAAD(associatedData);
          decipher.setAuthTag(envelope.tag);
          plaintext = Buffer.concat([
            decipher.update(envelope.ciphertext),
            decipher.final()
          ]).toString('utf8');
        } catch (error) {
          errors.push(error);
          continue;
        }

        return JSON.parse(plaintext);
      }

      throw new AggregateError(errors, 'Unable to decrypt persisted payload');
    }
  };
};

const assertStorageSecret = (secret: string, label: 'current' | 'next') => {
  if (Buffer.byteLength(secret, 'utf8') < 16 || secret.trim().length === 0) {
    throw new Error(`SQLite ${label} encryption secret must contain at least 16 UTF-8 bytes`);
  }
};

const deriveKey = (secret: string) =>
  Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('webperf-selfhosted/sqlite-encryption-salt/v1', 'utf8'),
      Buffer.from('webperf-selfhosted/sqlite-encryption-key/v1', 'utf8'),
      32
    )
  );

const deriveLegacyKey = (secret: string) => createHash('sha256').update(secret, 'utf8').digest();

const isEncryptedEnvelope = (value: string) =>
  value.startsWith(`${currentEnvelopePrefix}:`) || value.startsWith(`${legacyEnvelopePrefix}:`);

const parseEnvelope = (value: string) => {
  const parts = value.split(':');

  const prefix = parts.slice(0, 3).join(':');

  if (parts.length !== 6 || (prefix !== currentEnvelopePrefix && prefix !== legacyEnvelopePrefix)) {
    throw new InvalidEncryptedPayloadEnvelopeError();
  }

  const iv = Buffer.from(parts[3] ?? '', 'base64url');
  const tag = Buffer.from(parts[4] ?? '', 'base64url');
  const ciphertext = Buffer.from(parts[5] ?? '', 'base64url');

  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new InvalidEncryptedPayloadEnvelopeError();
  }

  return { prefix, iv, tag, ciphertext };
};
