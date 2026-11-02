import { now } from '../shared.js';

function matchesDate(value, date, isEnd) {
  if (!date) return true;
  const timestamp = new Date(value).getTime();
  const boundary = new Date(`${date}T${isEnd ? '23:59:59.999' : '00:00:00.000'}Z`).getTime();
  return isEnd ? timestamp <= boundary : timestamp >= boundary;
}

function matchesText(value, search) {
  return !search || String(value ?? '').toLocaleLowerCase().includes(search.toLocaleLowerCase());
}

function shapeEvent(event, repo) {
  const actor = repo.users.find((user) => user.id === event.actorId);
  const organization = repo.organizations.find((item) => item.id === event.organizationId);
  const campus = repo.campuses.find((item) => item.id === event.campusId);
  const details = event.after && typeof event.after === 'object' ? event.after : {};
  return {
    id: event.id, organizationId: event.organizationId, organizationName: organization?.name ?? '',
    campusId: event.campusId, campusName: campus?.name ?? '', actorId: event.actorId,
    actorName: actor?.name ?? (event.actorId === 'unknown' ? 'Unknown user' : ''),
    actorEmail: actor?.email ?? '', actorRole: actor?.role ?? '',
    action: event.action, entityType: event.entityType, entityId: event.entityId,
    before: event.before ?? null, after: event.after ?? null,
    ipAddress: details.ipAddress ?? '', userAgent: details.userAgent ?? '',
    createdAt: event.createdAt
  };
}

function canSeeEvent(event, actor) {
  if (actor.role === 'super_admin') return true;
  return event.organizationId === actor.orgId && event.campusId === actor.activeCampusId;
}

export const memoryAuditBundle = {
  async listAuditEvents(filters, actor) {
    const search = filters.search?.trim();
    const rows = this.audit.filter((event) => canSeeEvent(event, actor))
      .filter((event) => !filters.actions || filters.actions.includes(event.action))
      .filter((event) => !filters.userId || event.actorId === filters.userId)
      .filter((event) => matchesText(event.action, filters.action))
      .filter((event) => matchesText(event.entityType, filters.entityType))
      .filter((event) => matchesText(event.entityId, filters.entityId))
      .filter((event) => matchesDate(event.createdAt, filters.from, false))
      .filter((event) => matchesDate(event.createdAt, filters.to, true))
      .map((event) => shapeEvent(event, this))
      .filter((event) => !search || [
        event.organizationName, event.campusName, event.actorName, event.actorEmail,
        event.actorRole, event.action, event.entityType, event.entityId,
        JSON.stringify(event.before ?? ''), JSON.stringify(event.after ?? '')
      ].some((value) => matchesText(value, search)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const offset = (filters.page - 1) * filters.pageSize;
    return {
      events: rows.slice(offset, offset + filters.pageSize),
      total: rows.length, page: filters.page, pageSize: filters.pageSize
    };
  },
  async listActiveSessions(actor) {
    const currentTime = Date.now();
    return [...this.authSessions.values()]
      .filter((session) => !session.revokedAt && new Date(session.expiresAt).getTime() > currentTime)
      .filter((session) => {
        const user = this.users.find((item) => item.id === session.userId && item.isActive);
        if (!user) return false;
        if (actor.role === 'super_admin') return true;
        return session.organizationId === actor.orgId && session.campusId === actor.activeCampusId;
      })
      .map((session) => {
        const user = this.users.find((item) => item.id === session.userId);
        const campus = this.campuses.find((item) => item.id === session.campusId);
        return {
          sessionId: session.id, userId: session.userId, name: user?.name ?? '',
          email: user?.email ?? '', role: user?.role ?? '', campusName: campus?.name ?? '',
          ipAddress: session.ipAddress ?? '', userAgent: session.userAgent ?? '',
          createdAt: session.createdAt, lastSeenAt: session.lastSeenAt,
          expiresAt: session.expiresAt
        };
      })
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  },
  async isSessionActive(sessionId, userId) {
    const session = this.authSessions.get(sessionId);
    return Boolean(session && session.userId === userId && !session.revokedAt &&
      new Date(session.expiresAt).getTime() > Date.now());
  },
  async revokeSession(sessionId, actor) {
    const session = this.authSessions.get(sessionId);
    if (!session || session.revokedAt || new Date(session.expiresAt) <= new Date()) return false;
    if (actor.role !== 'super_admin' &&
        (session.organizationId !== actor.orgId || session.campusId !== actor.activeCampusId)) return false;
    session.revokedAt = now();
    for (const [hash, token] of this.refreshTokens) {
      if (token.sessionId === sessionId) this.refreshTokens.delete(hash);
    }
    await this.appendAudit(actor, 'auth.session_revoked', 'auth_session', sessionId,
      { revokedAt: null }, { revokedAt: session.revokedAt });
    return true;
  }
};
