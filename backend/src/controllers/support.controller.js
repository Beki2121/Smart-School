import { createHash, randomBytes } from 'node:crypto';
import { getRuntimeStatus } from '../runtime-status.js';

export function createSupportController(context) {
  const { repo, parse, mailer, supportListQuerySchema, supportTicketSchema,
    supportTicketUpdateSchema, supportCommentSchema, supportAttachmentSchema,
    integrationTestEmailSchema } = context;
  const missing = (res) => res.status(404).json({
    error: { code: 'SUPPORT_TICKET_NOT_FOUND', message: 'Support ticket not found.' }
  });
  return {
    tickets: async (req, res, next, mode) => {
      try { res.json({ data: await repo.listSupportTickets(
        parse(supportListQuerySchema, req.query), req.user, mode) }); }
      catch (error) { next(error); }
    },
    assignees: async (_req, res, next) => {
      try { res.json({ data: await repo.listSupportAssignees() }); }
      catch (error) { next(error); }
    },
    createTicket: async (req, res, next, ticketType) => {
      try { res.status(201).json({ data: await repo.createSupportTicket(
        parse(supportTicketSchema, req.body), req.user, ticketType) }); }
      catch (error) { next(error); }
    },
    ticket: async (req, res, next, mode) => {
      try {
        const row = await repo.getSupportTicket(req.params.ticketId, req.user, mode);
        if (!row) return missing(res);
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    updateTicket: async (req, res, next, mode) => {
      try {
        const row = await repo.updateSupportTicket(req.params.ticketId,
          parse(supportTicketUpdateSchema, req.body), req.user, mode);
        if (!row) return missing(res);
        res.json({ data: row });
      } catch (error) { next(error); }
    },
    comment: async (req, res, next, mode) => {
      try {
        const data = parse(supportCommentSchema, req.body);
        if (mode === 'platform-internal') data.isInternal = true;
        if (data.isInternal && mode !== 'platform-internal') {
          return res.status(403).json({ error: {
            code: 'SUPPORT_INTERNAL_NOTE_FORBIDDEN',
            message: 'A separate platform permission is required for internal notes.'
          } });
        }
        const row = await repo.addSupportComment(req.params.ticketId,
          data, req.user, mode);
        if (!row) return missing(res);
        res.status(201).json({ data: row });
      } catch (error) { next(error); }
    },
    attachment: async (req, res, next, mode, getOriginalName) => {
      try {
        const metadata = parse(supportAttachmentSchema, {
          originalName: getOriginalName(req),
          mimeType: req.headers['content-type']
        });
        const row = await repo.addSupportAttachment(req.params.ticketId,
          { ...metadata, content: req.body }, req.user, mode);
        if (!row) return missing(res);
        res.status(201).json({ data: row });
      } catch (error) { next(error); }
    },
    downloadAttachment: async (req, res, next, mode) => {
      try {
        const row = await repo.getSupportAttachment(req.params.attachmentId, req.user, mode);
        if (!row) return res.status(404).json({
          error: { code: 'SUPPORT_ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' }
        });
        res.set('Cache-Control', 'private, no-store');
        res.type(row.mimeType).attachment(row.originalName).send(row.content);
      } catch (error) { next(error); }
    },
    monitoring: async (_req, res, next) => {
      try {
        res.json({ data: await repo.getPlatformMonitoringSnapshot(getRuntimeStatus()) });
      } catch (error) { next(error); }
    },
    backupHistory: async (_req, res, next) => {
      try { res.json({ data: await repo.listBackupRuns(50) }); }
      catch (error) { next(error); }
    },
    emailIntegration: async (_req, res, next) => {
      try {
        const mailInfo = mailer ? await mailer.getIntegrationInfo()
          : { configured: false, fromAddress: null };
        const data = await repo.getEmailIntegrationStatus(_req.user, mailInfo);
        await repo.appendAudit(_req.user, 'integration.email_configuration_viewed',
          'email_integration', _req.user.orgId, null, { configured: data.configured });
        res.set('Cache-Control', 'no-store').json({ data });
      } catch (error) { next(error); }
    },
    requestEmailVerification: async (req, res, next) => {
      try {
        const user = await repo.findUserById(req.user.sub);
        if (!user?.email) return res.status(409).json({ error: {
          code: 'EMAIL_ADDRESS_REQUIRED',
          message: 'Add an account email address before requesting verification.'
        } });
        if (user.emailVerifiedAt) return res.json({ data: { verified: true } });
        if (!mailer || !await mailer.isConfigured()) {
          return res.status(503).json({ error: {
            code: 'EMAIL_INTEGRATION_NOT_CONFIGURED',
            message: 'Email is not configured. Contact the platform administrator.'
          } });
        }
        const token = randomBytes(32).toString('base64url');
        await repo.createEmailVerificationToken(req.user,
          createHash('sha256').update(token).digest('hex'),
          new Date(Date.now() + 30 * 60_000).toISOString());
        try {
          await mailer.sendEmailVerification({ email: user.email, token });
        } catch {
          await repo.appendAudit(req.user, 'integration.email_verification_failed',
            'email_integration', req.user.orgId, null, { result: 'failed' });
          return res.status(502).json({ error: {
            code: 'EMAIL_VERIFICATION_SEND_FAILED',
            message: 'The verification message could not be sent. Check the email provider configuration.'
          } });
        }
        await repo.appendAudit(req.user, 'integration.email_verification_requested',
          'email_integration', req.user.orgId, null, { result: 'sent' });
        res.set('Cache-Control', 'no-store').json({ data: { sent: true } });
      } catch (error) { next(error); }
    },
    confirmEmailVerification: async (req, res, next) => {
      try {
        const { token } = parse(context.emailVerificationTokenSchema, req.body);
        const tokenHash = createHash('sha256').update(token).digest('hex');
        if (!await repo.verifyEmailAddress(req.user, tokenHash)) {
          return res.status(400).json({ error: {
            code: 'EMAIL_VERIFICATION_INVALID',
            message: 'The verification code is invalid, expired, or already used.'
          } });
        }
        res.set('Cache-Control', 'no-store').json({ data: { verified: true } });
      } catch (error) { next(error); }
    },
    testEmail: async (req, res, next) => {
      try {
        parse(integrationTestEmailSchema, req.body);
        const user = await repo.findUserById(req.user.sub);
        if (!user?.email || !user.emailVerifiedAt) {
          return res.status(403).json({ error: {
            code: 'EMAIL_TEST_REQUIRES_VERIFIED_ACCOUNT_ADDRESS',
            message: 'Verify your account email before sending an integration test.'
          } });
        }
        const email = user.email;
        if (!mailer || !await mailer.isConfigured()) {
          return res.status(503).json({ error: {
            code: 'EMAIL_INTEGRATION_NOT_CONFIGURED',
            message: 'Email is not configured. Contact the platform administrator.'
          } });
        }
        try {
          await mailer.sendTestEmail({ email });
        } catch {
          await repo.recordEmailIntegrationTest(req.user, 'failed', 'EMAIL_PROVIDER_FAILED');
          await repo.appendAudit(req.user, 'integration.email_test_failed',
            'email_integration', req.user.orgId, null, { result: 'failed' });
          return res.status(502).json({ error: {
            code: 'EMAIL_TEST_SEND_FAILED',
            message: 'The test message could not be sent. Check the email provider configuration.'
          } });
        }
        await repo.recordEmailIntegrationTest(req.user, 'succeeded', null);
        await repo.appendAudit(req.user, 'integration.email_test_sent',
          'email_integration', req.user.orgId, null, { recipient: email });
        res.set('Cache-Control', 'no-store').json({ data: { sent: true } });
      } catch (error) { next(error); }
    }
  };
}
