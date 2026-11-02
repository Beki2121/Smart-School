import { createAuditController } from '../controllers/audit.controller.js';

export function registerAuditRoutes(app, dependencies) {
  const controller = createAuditController(dependencies);
  app.get('/api/audit-log', dependencies.requirePermission('audit.view'), controller.listAudit);
  app.get('/api/audit-log.csv', dependencies.requirePermission('audit.view'), controller.exportAudit);
  app.get('/api/login-history', dependencies.requirePermission('audit.view'), controller.listLoginHistory);
  app.get('/api/audit-sessions', dependencies.requirePermission('session.manage'), controller.listSessions);
  app.delete('/api/audit-sessions/:sessionId', dependencies.requirePermission('session.manage'), controller.revokeSession);
}
