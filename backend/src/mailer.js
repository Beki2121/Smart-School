import nodemailer from 'nodemailer';

export function createMailer(config, getOverride = null) {
  if (!config.SMTP_HOST && !getOverride) return null;
  const effectiveSettings = async () => ({ ...config, ...(await getOverride?.() ?? {}) });
  const createTransport = (settings) => nodemailer.createTransport({
    host: settings.SMTP_HOST,
    port: settings.SMTP_PORT,
    secure: settings.SMTP_SECURE,
    requireTLS: settings.NODE_ENV === 'production' && !settings.SMTP_SECURE,
    auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD }
  });
  return {
    async isConfigured() {
      const settings = await effectiveSettings();
      return Boolean(settings.SMTP_HOST && settings.SMTP_USER && settings.SMTP_PASSWORD);
    },
    async getIntegrationInfo() {
      const settings = await effectiveSettings();
      return {
        configured: Boolean(settings.SMTP_HOST && settings.SMTP_USER && settings.SMTP_PASSWORD),
        fromAddress: settings.SMTP_FROM ?? null
      };
    },
    async sendPasswordResetEmail({ email, name, resetUrl }) {
      const settings = await effectiveSettings();
      if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASSWORD) {
        throw new Error('SMTP settings are incomplete.');
      }
      const transport = createTransport(settings);
      const safeName = String(name).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
      await transport.sendMail({
        from: settings.SMTP_FROM,
        to: email,
        subject: 'Reset your SIMS password',
        text: `Hello ${name},\n\nUse this link within 30 minutes to reset your SIMS password:\n${resetUrl}\n\nIf you did not request this, you can ignore this message.`,
        html: `<p>Hello ${safeName},</p><p>Use this link within 30 minutes to reset your SIMS password:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this message.</p>`
      });
    },
    async sendSubscriptionExpiryEmail({ email, name, schoolName, expiryAt, thresholdDays }) {
      const settings = await effectiveSettings();
      if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASSWORD) {
        throw new Error('SMTP settings are incomplete.');
      }
      const transport = createTransport(settings);
      const timing = thresholdDays === 0 ? 'has expired'
        : `expires in ${thresholdDays} day${thresholdDays === 1 ? '' : 's'}`;
      const safe = (value) => String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
      await transport.sendMail({
        from: settings.SMTP_FROM,
        to: email,
        subject: `SIMS subscription ${timing}`,
        text: `Hello ${name},\n\nThe subscription for ${schoolName} ${timing}. Expiry date: ${expiryAt.slice(0, 10)}.`,
        html: `<p>Hello ${safe(name)},</p><p>The subscription for ${safe(schoolName)} ${timing}. Expiry date: ${safe(expiryAt.slice(0, 10))}.</p>`
      });
    },
    async sendTestEmail({ email }) {
      const settings = await effectiveSettings();
      if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASSWORD) {
        throw new Error('SMTP settings are incomplete.');
      }
      await createTransport(settings).sendMail({
        from: settings.SMTP_FROM, to: email, subject: 'SIMS email integration test',
        text: 'This is a test message confirming that the school email integration is working.'
      });
    },
    async sendEmailVerification({ email, token }) {
      const settings = await effectiveSettings();
      if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASSWORD) {
        throw new Error('SMTP settings are incomplete.');
      }
      await createTransport(settings).sendMail({
        from: settings.SMTP_FROM, to: email, subject: 'Verify your SIMS email address',
        text: `Use this verification code in SIMS to confirm your email address. The code expires in 30 minutes:\n\n${token}`
      });
    }
  };
}
