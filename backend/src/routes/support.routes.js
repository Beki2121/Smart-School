import express from 'express';
import rateLimit from 'express-rate-limit';
import { createSupportController } from '../controllers/support.controller.js';

export function registerSupportRoutes(app, context, dependencies) {
  const controller = createSupportController({
    ...context, repo: dependencies.repo, mailer: dependencies.mailer
  });
  const handler = (name, ...args) => (req, res, next) => controller[name](req, res, next, ...args);
  const customer = context.requirePermission('support.tickets.view');
  const customerCreate = context.requirePermission('support.tickets.create');
  const internalView = context.requirePermission('support.internal.view');
  const internalManage = context.requirePermission('support.internal.manage');
  const platformView = context.requirePermission('support.platform.view');
  const platformManage = context.requirePermission('support.platform.manage');
  const fileUpload = express.raw({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'], limit: '5mb'
  });
  const attachmentName = (request) => {
    try { return decodeURIComponent(request.headers['x-file-name'] ?? ''); }
    catch { return request.headers['x-file-name'] ?? ''; }
  };

  app.get('/api/support/tickets', customer, handler('tickets', 'customer'));
  app.post('/api/support/tickets', customerCreate,
    handler('createTicket', 'platform'));
  app.get('/api/support/tickets/:ticketId', customer, handler('ticket', 'customer'));
  app.post('/api/support/tickets/:ticketId/comments', customer,
    handler('comment', 'customer'));
  app.post('/api/support/tickets/:ticketId/attachments', customerCreate, fileUpload,
    handler('attachment', 'customer', attachmentName));
  app.get('/api/support/attachments/:attachmentId', customer,
    handler('downloadAttachment', 'customer'));

  app.get('/api/school/it-tickets', internalView, handler('tickets', 'internal'));
  app.post('/api/school/it-tickets', internalManage,
    handler('createTicket', 'internal'));
  app.get('/api/school/it-tickets/:ticketId', internalView, handler('ticket', 'internal'));
  app.patch('/api/school/it-tickets/:ticketId', internalManage,
    handler('updateTicket', 'internal'));
  app.post('/api/school/it-tickets/:ticketId/comments', internalManage,
    handler('comment', 'internal'));
  app.post('/api/school/it-tickets/:ticketId/attachments', internalManage, fileUpload,
    handler('attachment', 'internal', attachmentName));
  app.get('/api/school/it-attachments/:attachmentId', internalView,
    handler('downloadAttachment', 'internal'));

  app.get('/api/platform/support/tickets', platformView, handler('tickets', 'platform'));
  app.get('/api/platform/support/tickets/:ticketId', platformView, handler('ticket', 'platform'));
  app.patch('/api/platform/support/tickets/:ticketId', platformManage,
    handler('updateTicket', 'platform'));
  app.post('/api/platform/support/tickets/:ticketId/comments', platformManage,
    handler('comment', 'platform'));
  app.post('/api/platform/support/tickets/:ticketId/attachments', platformManage, fileUpload,
    handler('attachment', 'platform', attachmentName));
  app.get('/api/platform/support/attachments/:attachmentId', platformView,
    handler('downloadAttachment', 'platform'));

  app.get('/api/platform/monitoring', context.requirePermission('platform.monitor.view'),
    handler('monitoring'));
  app.get('/api/platform/backups', context.requirePermission('platform.backups.view'),
    handler('backupHistory'));
  app.get('/api/school/integrations/email',
    context.requirePermission('integrations.email.view'), handler('emailIntegration'));
  app.post('/api/school/integrations/email/test',
    context.requirePermission('integrations.email.test'),
    rateLimit({ windowMs: 15 * 60_000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false }),
    handler('testEmail'));
}
