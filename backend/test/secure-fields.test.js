import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptSensitiveValue, encryptSensitiveValue, hashSensitiveIdentifier
} from '../src/secure-fields.js';

const key = randomBytes(32).toString('base64url');

describe('protected student field cryptography', () => {
  it('encrypts with authenticated randomized envelopes and decrypts the original value', () => {
    const first = encryptSensitiveValue('student identifier', key);
    const second = encryptSensitiveValue('student identifier', key);
    assert.notEqual(first, second);
    assert.ok(!first.includes('student identifier'));
    assert.equal(decryptSensitiveValue(first, key), 'student identifier');
    const tampered = first.split('.');
    tampered[2] = `${tampered[2][0] === 'A' ? 'B' : 'A'}${tampered[2].slice(1)}`;
    assert.throws(() => decryptSensitiveValue(tampered.join('.'), key));
  });

  it('derives a stable keyed identifier hash and masks identifiers', () => {
    assert.equal(hashSensitiveIdentifier('  ET-1234  ', key), hashSensitiveIdentifier('ET-1234', key));
    assert.notEqual(hashSensitiveIdentifier('ET-1234', key), hashSensitiveIdentifier('ET-1234', randomBytes(32).toString('base64url')));
  });

  it('requires a configured key before encrypting sensitive values', () => {
    assert.throws(() => encryptSensitiveValue('private', ''), {
      code: 'SENSITIVE_DATA_KEY_NOT_CONFIGURED', status: 503
    });
  });

  it('rejects repeated-byte default encryption keys', () => {
    const defaultKey = Buffer.alloc(32).toString('base64url');
    assert.throws(() => encryptSensitiveValue('private', defaultKey), {
      code: 'SENSITIVE_DATA_KEY_NOT_CONFIGURED', status: 503
    });
  });
});
