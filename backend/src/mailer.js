import nodemailer from 'nodemailer';

export function createMailer(config, getOverride = null) {
  if (!config.SMTP_HOST && !getOverride) return null;
  const effectiveSettings = async () => ({ ...config, ...(await getOverride?.() ?? {}) });
  return {
    async isConfigured() {
      const settings = await effectiveSettings();
      return Boolean(settings.SMTP_HOST && settings.SMTP_USER && settings.SMTP_PASSWORD);
    },
    async sendPasswordResetEmail({ email, name, resetUrl }) {
      const settings = await effectiveSettings();
      if (!settings.SMTP_HOST || !settings.SMTP_USER || !settings.SMTP_PASSWORD) {
        throw new Error('SMTP settings are incomplete.');
      }
      const transport = nodemailer.createTransport({
        host: settings.SMTP_HOST,
        port: settings.SMTP_PORT,
        secure: settings.SMTP_SECURE,
        requireTLS: settings.NODE_ENV === 'production' && !settings.SMTP_SECURE,
        auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD }
      });
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
    }
  };
}
