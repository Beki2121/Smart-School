import { auditRow } from '../shared.js';

function parseJson(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch (error) { throw new Error('Audit event JSON is invalid.', { cause: error }); }
}

function applyAuditFilters(query, filters, actor) {
  if (actor.role !== 'super_admin') {
    query.where('a.organization_id', actor.orgId).where('a.campus_id', actor.activeCampusId);
  }
  if (filters.actions) query.whereIn('a.action', filters.actions);
  if (filters.userId) query.where('a.actor_id', filters.userId);
  if (filters.action) query.where('a.action', 'like', `%${filters.action}%`);
  if (filters.entityType) query.where('a.entity_type', 'like', `%${filters.entityType}%`);
  if (filters.entityId) query.where('a.entity_id', 'like', `%${filters.entityId}%`);
  if (filters.from) query.where('a.created_at', '>=', `${filters.from} 00:00:00`);
  if (filters.to) query.where('a.created_at', '<=', `${filters.to} 23:59:59`);
  if (filters.search) {
    const search = `%${filters.search}%`;
    query.where(function () {
      this.where('a.action', 'like', search)
        .orWhere('a.entity_type', 'like', search)
        .orWhere('a.entity_id', 'like', search)
        .orWhere('u.name', 'like', search)
        .orWhere('u.email', 'like', search)
        .orWhere('o.name', 'like', search)
        .orWhere('c.name', 'like', search);
    });
  }
}

function auditQuery(db) {
  return db('audit_log as a')
    .leftJoin('users as u', 'u.id', 'a.actor_id')
    .leftJoin('organizations as o', 'o.id', 'a.organization_id')
    .leftJoin('campuses as c', 'c.id', 'a.campus_id');
}

export const mysqlAuditBundle = {
  async listAuditEvents(filters, actor) {
    const countQuery = auditQuery(this.db).count({ total: 'a.id' });
    applyAuditFilters(countQuery, filters, actor);
    const count = await countQuery.first();
    const query = auditQuery(this.db).select(
      'a.id', 'a.organization_id', 'o.name as organization_name',
      'a.campus_id', 'c.name as campus_name', 'a.actor_id', 'u.name as actor_name',
      'u.email as actor_email', 'u.role as actor_role', 'a.action', 'a.entity_type',
      'a.entity_id', 'a.before_json', 'a.after_json', 'a.created_at'
    );
    applyAuditFilters(query, filters, actor);
    const rows = await query.orderBy('a.created_at', 'desc').orderBy('a.id', 'desc')
      .limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize);
    const events = rows.map((row) => {
      const before = parseJson(row.before_json);
      const after = parseJson(row.after_json);
      return {
        id: row.id, organizationId: row.organization_id,
        organizationName: row.organization_name ?? '', campusId: row.campus_id,
        campusName: row.campus_name ?? '', actorId: row.actor_id,
        actorName: row.actor_name ?? (row.action === 'auth.login_failed' ? 'Unknown user' : ''),
        actorEmail: row.actor_email ?? '', actorRole: row.actor_role ?? '',
        action: row.action, entityType: row.entity_type, entityId: row.entity_id,
        before, after, ipAddress: after?.ipAddress ?? '', userAgent: after?.userAgent ?? '',
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
      };
    });
    return {
      events, total: Number(count.total), page: filters.page, pageSize: filters.pageSize
    };
  },
  async listActiveSessions(actor) {
    const query = this.db('auth_sessions as s')
      .join('users as u', 'u.id', 's.user_id')
      .leftJoin('campuses as c', 'c.id', 's.campus_id')
      .whereNull('s.revoked_at').where('s.expires_at', '>', this.db.fn.now())
      .where('u.is_active', true);
    if (actor.role !== 'super_admin') {
      query.where('s.organization_id', actor.orgId).where('s.campus_id', actor.activeCampusId);
    }
    const rows = await query.orderBy('s.last_seen_at', 'desc').select(
      's.id as session_id', 's.user_id', 'u.name', 'u.email', 'u.role',
      'c.name as campus_name', 's.ip_address', 's.user_agent', 's.created_at',
      's.last_seen_at', 's.expires_at'
    );
    return rows.map((row) => ({
      sessionId: row.session_id, userId: row.user_id, name: row.name,
      email: row.email ?? '', role: row.role, campusName: row.campus_name ?? '',
      ipAddress: row.ip_address ?? '', userAgent: row.user_agent ?? '',
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : String(row.last_seen_at),
      expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at)
    }));
  },
  async isSessionActive(sessionId, userId) {
    const session = await this.db('auth_sessions').where({
      id: sessionId, user_id: userId
    }).whereNull('revoked_at').where('expires_at', '>', this.db.fn.now()).first('id');
    return Boolean(session);
  },
  async revokeSession(sessionId, actor) {
    return this.db.transaction(async (trx) => {
      let query = trx('auth_sessions').where({ id: sessionId })
        .whereNull('revoked_at').where('expires_at', '>', trx.fn.now()).forUpdate();
      if (actor.role !== 'super_admin') {
        query = query.where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId
        });
      }
      const session = await query.first('id', 'user_id', 'organization_id', 'campus_id');
      if (!session) return false;
      await trx('auth_sessions').where({ id: sessionId }).update({ revoked_at: trx.fn.now() });
      await trx('refresh_tokens').where({ session_id: sessionId }).whereNull('revoked_at')
        .update({ revoked_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow({
        ...actor, orgId: session.organization_id, activeCampusId: session.campus_id
      }, 'auth.session_revoked', 'auth_session', sessionId, { revokedAt: null }, {
        revokedAt: new Date().toISOString()
      }));
      return true;
    });
  }
};
