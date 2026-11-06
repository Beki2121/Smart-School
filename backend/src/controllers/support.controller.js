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
        const row = await repo.addSupportComment(req.params.ticketId,
          parse(supportCommentSchema, req.body), req.user, mode);
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
        res.set('Cache-Control', 'no-store').json({
          data: { configured: Boolean(mailer && await mailer.isConfigured()) }
        });
      } catch (error) { next(error); }
    },
    testEmail: async (req, res, next) => {
      try {
        const { email } = parse(integrationTestEmailSchema, req.body);
        if (!mailer || !await mailer.isConfigured()) {
          return res.status(503).json({ error: {
            code: 'EMAIL_INTEGRATION_NOT_CONFIGURED',
            message: 'Email is not configured. Contact the platform administrator.'
          } });
        }
        await mailer.sendTestEmail({ email });
        await repo.appendAudit(req.user, 'integration.email_test_sent',
          'email_integration', req.user.orgId, null, { recipient: email });
        res.set('Cache-Control', 'no-store').json({ data: { sent: true } });
      } catch (error) { next(error); }
    }
  };
}
