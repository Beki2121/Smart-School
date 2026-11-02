import { auditExportQuerySchema, auditQuerySchema, sessionIdSchema } from '../schemas/audit.schema.js';

const loginActions = ['auth.login', 'auth.login_failed', 'auth.logout'];

function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function createAuditController({ repo, parse }) {
  return {
    listAudit: async (request, response, next) => {
      try {
        const filters = parse(auditQuerySchema, request.query);
        response.json({ data: await repo.listAuditEvents(filters, request.user) });
      } catch (error) { next(error); }
    },
    exportAudit: async (request, response, next) => {
      try {
        const filters = parse(auditExportQuerySchema, request.query);
        const { events } = await repo.listAuditEvents({ ...filters, page: 1 }, request.user);
        const body = csv([
          ['Timestamp', 'Organization', 'Campus', 'User', 'Role', 'Action', 'Entity type',
            'Entity ID', 'IP address', 'User agent', 'Before', 'After'],
          ...events.map((event) => [
            event.createdAt, event.organizationName, event.campusName, event.actorName,
            event.actorRole, event.action, event.entityType, event.entityId,
            event.ipAddress, event.userAgent, JSON.stringify(event.before ?? ''),
            JSON.stringify(event.after ?? '')
          ])
        ]);
        response.type('text/csv').set('Content-Disposition', 'attachment; filename="audit-log.csv"')
          .send(body);
      } catch (error) { next(error); }
    },
    listLoginHistory: async (request, response, next) => {
      try {
        const filters = parse(auditQuerySchema, request.query);
        response.json({
          data: await repo.listAuditEvents({ ...filters, actions: loginActions }, request.user)
        });
      } catch (error) { next(error); }
    },
    listSessions: async (request, response, next) => {
      try {
        response.json({ data: await repo.listActiveSessions(request.user) });
      } catch (error) { next(error); }
    },
    revokeSession: async (request, response, next) => {
      try {
        const sessionId = parse(sessionIdSchema, request.params.sessionId);
        const revoked = await repo.revokeSession(sessionId, request.user);
        if (!revoked) return response.status(404).json({
          error: { code: 'SESSION_NOT_FOUND', message: 'Active session not found.' }
        });
        response.status(204).end();
      } catch (error) { next(error); }
    }
  };
}
