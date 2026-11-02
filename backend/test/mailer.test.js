import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer } from '../src/mailer.js';

describe('configured mail transport', () => {
  it('does not fall back to environment credentials when persisted credentials cannot be decrypted', async () => {
    const mailer = createMailer({
      SMTP_HOST: 'mail.example.test', SMTP_PORT: 587, SMTP_SECURE: false,
      SMTP_USER: 'environment-user', SMTP_PASSWORD: 'environment-password',
      SMTP_FROM: 'noreply@example.test'
    }, async () => {
      throw Object.assign(new Error('decryption failed'), {
        code: 'SENSITIVE_DATA_KEY_NOT_CONFIGURED'
      });
    });

    await assert.rejects(mailer.isConfigured(), {
      code: 'SENSITIVE_DATA_KEY_NOT_CONFIGURED'
    });
  });
});
