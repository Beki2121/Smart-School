import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const salt = Buffer.from('smartschool-sims-sensitive-fields-v1');

function deriveKey(configuredKey, purpose) {
  if (!configuredKey) {
    const error = new Error('Sensitive-data encryption is not configured. Set SENSITIVE_DATA_KEY before managing protected student data.');
    error.status = 503;
    error.code = 'SENSITIVE_DATA_KEY_NOT_CONFIGURED';
    throw error;
  }
  const key = Buffer.from(configuredKey, 'base64url');
  if (key.length !== 32) throw new Error('SENSITIVE_DATA_KEY must decode to exactly 32 bytes.');
  return Buffer.from(hkdfSync('sha256', key, salt, Buffer.from(`smartschool-sims:${purpose}`), 32));
}

export function encryptSensitiveValue(value, configuredKey) {
  if (value == null || value === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(configuredKey, 'encryption'), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSensitiveValue(envelope, configuredKey) {
  if (!envelope) return null;
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = envelope.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || encodedCiphertext === undefined || extra !== undefined) {
    throw new Error('Stored sensitive data has an invalid encryption envelope.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm', deriveKey(configuredKey, 'encryption'), Buffer.from(encodedIv, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()
  ]).toString('utf8');
}

export function hashSensitiveIdentifier(value, configuredKey) {
  if (value == null || value === '') return null;
  return createHmac('sha256', deriveKey(configuredKey, 'lookup'))
    .update(String(value).normalize('NFKC').trim()).digest('hex');
}
