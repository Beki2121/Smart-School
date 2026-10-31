import nodemailer from 'nodemailer';

export function createMailer(config) {
  if (!config.SMTP_HOST) return null;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    requireTLS: config.NODE_ENV === 'production' && !config.SMTP_SECURE,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
  });
  return {
    async sendPasswordResetEmail({ email, name, resetUrl }) {
      const safeName = String(name).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
      await transport.sendMail({
        from: config.SMTP_FROM,
        to: email,
        subject: 'Reset your SIMS password',
        text: `Hello ${name},\n\nUse this link within 30 minutes to reset your SIMS password:\n${resetUrl}\n\nIf you did not request this, you can ignore this message.`,
        html: `<p>Hello ${safeName},</p><p>Use this link within 30 minutes to reset your SIMS password:</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this message.</p>`
      });
    }
  };
}
