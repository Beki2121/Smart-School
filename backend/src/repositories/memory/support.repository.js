import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { now } from '../shared.js';

const attachmentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain']);

function supportError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function duplicateTicketError() {
  return supportError('SUPPORT_TICKET_DUPLICATE',
    'An active ticket with this subject and category already exists.', 409);
}

function modeAllows(ticket, mode, actor) {
  if (mode.startsWith('platform')) {
    return ['super_admin', 'support_staff'].includes(actor.role) &&
      ticket.ticketType === 'platform';
  }
  return ticket.organizationId === actor.orgId &&
    ticket.campusId === actor.activeCampusId &&
    (mode === 'internal' ? ticket.ticketType === 'internal' : ticket.ticketType === 'platform');
}

function cleanName(value) {
  return path.basename(String(value ?? 'attachment')).replace(/[^\w .()-]/g, '_').slice(0, 180) ||
    'attachment';
}

function mapTicket(ticket, comments = [], attachments = []) {
  return {
    id: ticket.id, organizationId: ticket.organizationId, campusId: ticket.campusId,
    ticketType: ticket.ticketType, subject: ticket.subject, category: ticket.category,
    priority: ticket.priority, status: ticket.status, createdBy: ticket.createdBy,
    assignedTo: ticket.assignedTo, resolvedAt: ticket.resolvedAt,
    createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, comments, attachments
  };
}

function mapBackupRun(row) {
  const { id, kind, startedAt, completedAt, status, sizeBytes, errorCode } = row;
  return { id, kind, startedAt, completedAt, status, sizeBytes, errorCode };
}

export const memorySupportBundle = {
  initSupport() {
    this.supportTickets ??= [];
    this.supportTicketComments ??= [];
    this.supportTicketAttachments ??= [];
    this.backupRuns ??= [];
    this.emailIntegrationTests ??= [];
    this.emailVerificationTokens ??= [];
  },
  async listSupportTickets(query, actor, mode) {
    this.initSupport();
    const rows = this.supportTickets.filter((ticket) => modeAllows(ticket, mode, actor) &&
      (!query.status || ticket.status === query.status) &&
      (!query.priority || ticket.priority === query.priority) &&
      (!query.search || `${ticket.subject} ${ticket.category}`.toLowerCase()
        .includes(query.search.toLowerCase())))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (query.page - 1) * query.pageSize;
    const page = rows.slice(offset, offset + query.pageSize);
    if (mode.startsWith('platform')) {
      for (const ticket of page) await this.appendAudit({
        ...actor, orgId: ticket.organizationId, activeCampusId: ticket.campusId
      }, 'support.ticket.cross_school_read', 'support_ticket', ticket.id, null, {
        access: 'list'
      });
    }
    return page.map((ticket) => mapTicket(ticket));
  },
  async listSupportAssignees() {
    return this.users.filter((user) =>
      ['super_admin', 'support_staff'].includes(user.role) && user.isActive !== false)
      .map((user) => ({ id: user.id, name: user.name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  },
  async createSupportTicket(data, actor, ticketType) {
    this.initSupport();
    const duplicate = this.supportTickets.some((ticket) =>
      ticket.organizationId === actor.orgId &&
      ticket.campusId === actor.activeCampusId &&
      ticket.ticketType === ticketType && ticket.createdBy === actor.sub &&
      ticket.subject.trim().toLocaleLowerCase() === data.subject.trim().toLocaleLowerCase() &&
      ticket.category === data.category &&
      ['open', 'assigned', 'in_progress', 'waiting_on_school'].includes(ticket.status));
    if (duplicate) throw duplicateTicketError();
    const row = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ticketType, subject: data.subject, category: data.category, priority: data.priority,
      status: 'open', createdBy: actor.sub, assignedTo: null, resolvedAt: null,
      createdAt: now(), updatedAt: now()
    };
    this.supportTickets.push(row);
    await this.appendAudit(actor, 'support.ticket.created', 'support_ticket', row.id, null, row);
    if (ticketType === 'platform') {
      const recipients = this.users.filter((user) =>
        ['super_admin', 'support_staff'].includes(user.role) &&
        user.isActive !== false).map((user) => user.id);
      await this.supportNotify(row, 'support.ticket.created', row.id,
        'Support ticket received', row.subject, recipients);
    }
    return mapTicket(row);
  },
  async getSupportTicket(id, actor, mode) {
    this.initSupport();
    const ticket = this.supportTickets.find((row) => row.id === id && modeAllows(row, mode, actor));
    if (!ticket) return null;
    if (mode.startsWith('platform')) await this.appendAudit({
      ...actor, orgId: ticket.organizationId, activeCampusId: ticket.campusId
    }, 'support.ticket.cross_school_read', 'support_ticket', ticket.id, null, {
      access: 'detail'
    });
    const comments = this.supportTicketComments.filter((row) => row.ticketId === id &&
      row.organizationId === ticket.organizationId && row.campusId === ticket.campusId &&
      (mode === 'platform' || !row.isInternal)).map((row) => ({
      id: row.id, authorId: row.authorId, body: row.body, isInternal: row.isInternal,
      createdAt: row.createdAt
    }));
    const attachments = this.supportTicketAttachments.filter((row) =>
      row.ticketId === id && row.organizationId === ticket.organizationId &&
      row.campusId === ticket.campusId)
      .map(({ content, ...row }) => row);
    return mapTicket(ticket, comments, attachments);
  },
  async updateSupportTicket(id, data, actor, mode) {
    this.initSupport();
    const ticket = this.supportTickets.find((row) => row.id === id && modeAllows(row, mode, actor));
    if (!ticket) return null;
    const before = structuredClone(ticket);
    const previousAssignee = ticket.assignedTo;
    const previousStatus = ticket.status;
    if (data.status !== undefined) {
      const transitions = {
        open: ['assigned', 'in_progress', 'waiting_on_school', 'resolved'],
        assigned: ['in_progress', 'waiting_on_school', 'resolved', 'open'],
        in_progress: ['assigned', 'waiting_on_school', 'resolved'],
        waiting_on_school: ['assigned', 'in_progress', 'resolved'],
        resolved: ['closed', 'open'],
        closed: ['open']
      };
      if (!(transitions[ticket.status] ?? []).includes(data.status)) {
        throw supportError('SUPPORT_TICKET_INVALID_STATE', 'Ticket status transition is invalid.');
      }
      ticket.status = data.status;
      if (data.status === 'resolved' && !ticket.resolvedAt) ticket.resolvedAt = now();
    }
    if (data.assignedTo !== undefined) {
      if (!mode.startsWith('platform')) {
        throw supportError('SUPPORT_ASSIGNMENT_FORBIDDEN', 'Only platform support can assign tickets.', 403);
      }
      const user = this.users.find((row) => row.id === data.assignedTo &&
        ['super_admin', 'support_staff'].includes(row.role) && row.isActive !== false);
      if (data.assignedTo && !user) {
        throw supportError('SUPPORT_ASSIGNEE_NOT_FOUND', 'Active platform support user not found.', 404);
      }
      ticket.assignedTo = data.assignedTo;
      if (data.status === undefined && data.assignedTo && ticket.status === 'open') {
        ticket.status = 'assigned';
      }
    }
    ticket.updatedAt = now();
    const scopedActor = { ...actor, orgId: ticket.organizationId,
      activeCampusId: ticket.campusId };
    if (ticket.assignedTo !== previousAssignee) {
      await this.appendAudit(scopedActor, 'support.ticket.assigned', 'support_ticket',
        id, before, ticket);
      await this.supportNotify(ticket, 'support.ticket.assigned',
        randomUUID(), 'Support ticket assigned', ticket.subject,
        [ticket.assignedTo, ticket.createdBy]);
    }
    if (ticket.status !== previousStatus) {
      const action = ticket.status === 'open' && ['resolved', 'closed'].includes(previousStatus)
        ? 'support.ticket.reopened' : 'support.ticket.status_changed';
      await this.appendAudit(scopedActor, action, 'support_ticket', id, before, ticket);
      await this.supportNotify(ticket, action, randomUUID(),
        'Support ticket status changed', `Ticket "${ticket.subject}" is ${ticket.status}.`,
        [ticket.createdBy, ticket.assignedTo]);
    }
    return mapTicket(ticket);
  },
  async addSupportComment(id, data, actor, mode) {
    this.initSupport();
    const ticket = this.supportTickets.find((row) => row.id === id && modeAllows(row, mode, actor));
    if (!ticket) return null;
    const row = {
      id: randomUUID(), organizationId: ticket.organizationId, campusId: ticket.campusId,
      ticketId: ticket.id, authorId: actor.sub,
      isInternal: mode.startsWith('platform') && Boolean(data.isInternal),
      body: data.body, createdAt: now()
    };
    this.supportTicketComments.push(row);
    await this.appendAudit({ ...actor, orgId: ticket.organizationId,
      activeCampusId: ticket.campusId }, 'support.ticket.comment_added', 'support_ticket_comment',
    row.id, null, row);
    if (!row.isInternal) await this.supportNotify(ticket, 'support.ticket.comment', row.id,
      'New support ticket comment', ticket.subject,
      [ticket.createdBy, ticket.assignedTo].filter((userId) => userId !== actor.sub));
    return { id: row.id, authorId: row.authorId, body: row.body,
      isInternal: row.isInternal, createdAt: row.createdAt };
  },
  async addSupportAttachment(id, data, actor, mode) {
    this.initSupport();
    const ticket = this.supportTickets.find((row) => row.id === id && modeAllows(row, mode, actor));
    if (!ticket) return null;
    if (!Buffer.isBuffer(data.content) || !data.content.length || data.content.length > 5 * 1024 * 1024 ||
        !attachmentTypes.has(data.mimeType)) {
      throw supportError('SUPPORT_ATTACHMENT_INVALID', 'Attachment must be a PDF, PNG, JPEG, or text file up to 5 MB.', 400);
    }
    await this.assertStorageCapacity(ticket.organizationId, data.content.length);
    const row = {
      id: randomUUID(), organizationId: ticket.organizationId, campusId: ticket.campusId,
      ticketId: ticket.id, uploadedBy: actor.sub, originalName: cleanName(data.originalName),
      mimeType: data.mimeType, sizeBytes: data.content.length,
      sha256: createHash('sha256').update(data.content).digest('hex'),
      content: Buffer.from(data.content), createdAt: now()
    };
    this.supportTicketAttachments.push(row);
    await this.appendAudit({ ...actor, orgId: ticket.organizationId,
      activeCampusId: ticket.campusId }, 'support.ticket.attachment_added',
    'support_ticket_attachment', row.id, null, { ...row, content: undefined });
    const { content, ...metadata } = row;
    return metadata;
  },
  async getSupportAttachment(id, actor, mode) {
    this.initSupport();
    const attachment = this.supportTicketAttachments.find((row) => row.id === id &&
      (mode === 'platform' || row.organizationId === actor.orgId) &&
      (mode === 'platform' || row.campusId === actor.activeCampusId));
    if (!attachment) return null;
    const ticket = this.supportTickets.find((row) => row.id === attachment.ticketId &&
      modeAllows(row, mode, actor));
    if (!ticket) return null;
    if (mode.startsWith('platform')) await this.appendAudit({
      ...actor, orgId: ticket.organizationId, activeCampusId: ticket.campusId
    }, 'support.ticket.cross_school_read', 'support_ticket', ticket.id, null, {
      access: 'attachment', attachmentId: attachment.id
    });
    return { ...attachment, content: Buffer.from(attachment.content) };
  },
  async checkDatabaseConnectivity() {
    return { reachable: true, mode: 'memory' };
  },
  async getPlatformMonitoringSnapshot(runtime) {
    this.initSupport();
    const schools = this.organizations.filter((row) => row.status !== 'platform')
      .map((row) => ({ id: row.id, name: row.name,
        usedBytes: this.getOrganizationStorageUsage(row.id) }));
    return {
      api: 'ok', database: { reachable: true, mode: 'memory' },
      storageBySchool: schools, runtime,
      backupLatest: this.backupRuns.at(-1)
        ? mapBackupRun(this.backupRuns.at(-1)) : null
    };
  },
  async createBackupRun() {
    this.initSupport();
    const row = { id: randomUUID(), organizationId: null, campusId: null,
      kind: 'database', startedAt: now(), completedAt: null, status: 'running', sizeBytes: null,
      artifactName: null, errorCode: null };
    this.backupRuns.push(row);
    await this.appendAudit({ sub: null, orgId: null, activeCampusId: null },
      'platform.backup.recorded', 'system_backup_run', row.id, null, {
        kind: row.kind, status: row.status
      });
    return { id: row.id };
  },
  async finishBackupRun(id, result) {
    this.initSupport();
    const row = this.backupRuns.find((item) => item.id === id);
    if (!row || row.status !== 'running') throw new Error('Active backup run was not found.');
    if (!['succeeded', 'failed'].includes(result.status)) {
      throw new Error('Backup result status is invalid.');
    }
    const before = { kind: row.kind, status: row.status };
    row.completedAt = now();
    row.status = result.status;
    row.sizeBytes = result.sizeBytes ?? null;
    row.artifactName = result.artifactName ?? null;
    row.errorCode = result.errorCode ?? null;
    await this.appendAudit({ sub: null, orgId: null, activeCampusId: null },
      'platform.backup.recorded', 'system_backup_run', row.id, before, {
        kind: row.kind, status: row.status, sizeBytes: row.sizeBytes,
        errorCode: row.errorCode
      });
    return structuredClone(row);
  },
  async listBackupRuns(limit = 50) {
    this.initSupport();
    return this.backupRuns.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit).map(mapBackupRun);
  },
  async getEmailIntegrationStatus(actor, mailInfo) {
    this.initSupport();
    const user = this.users.find((item) => item.id === actor.sub);
    const last = this.emailIntegrationTests.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId)
      .sort((left, right) => right.testedAt.localeCompare(left.testedAt))[0];
    return {
      ...mailInfo, emailAddress: user?.email ?? null,
      emailVerified: Boolean(user?.emailVerifiedAt),
      lastTestResult: last ? {
        result: last.result, testedAt: last.testedAt, errorCode: last.errorCode
      } : null
    };
  },
  async recordEmailIntegrationTest(actor, result, errorCode = null) {
    this.initSupport();
    const row = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      requestedBy: actor.sub, result, errorCode, testedAt: now()
    };
    this.emailIntegrationTests.push(row);
    return structuredClone(row);
  },
  async createEmailVerificationToken(actor, tokenHash, expiresAt) {
    this.initSupport();
    this.emailVerificationTokens = this.emailVerificationTokens.filter((row) =>
      row.userId !== actor.sub || row.usedAt);
    const row = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      userId: actor.sub, tokenHash, expiresAt, usedAt: null, createdAt: now()
    };
    this.emailVerificationTokens.push(row);
    return structuredClone(row);
  },
  async verifyEmailAddress(actor, tokenHash) {
    this.initSupport();
    const token = this.emailVerificationTokens.find((row) =>
      row.tokenHash === tokenHash && row.userId === actor.sub &&
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId &&
      !row.usedAt && Date.parse(row.expiresAt) > Date.now());
    if (!token) return false;
    token.usedAt = now();
    const user = this.users.find((row) => row.id === actor.sub &&
      row.orgId === actor.orgId);
    if (!user || !user.email) return false;
    user.emailVerifiedAt = token.usedAt;
    await this.appendAudit(actor, 'integration.email_verified', 'user', user.id, null, {
      emailVerified: true
    });
    return true;
  },
  async supportNotify(ticket, sourceType, sourceId, title, body, recipientIds = []) {
    const recipients = [...new Set(recipientIds.filter(Boolean))];
    for (const userId of recipients) {
      const exists = this.userNotifications.some((notice) => notice.userId === userId &&
        notice.sourceType === sourceType && notice.sourceId === sourceId);
      if (exists) continue;
      this.userNotifications.unshift({
        id: randomUUID(), organizationId: ticket.organizationId, campusId: ticket.campusId,
        userId, sourceType, sourceId, titleEn: title, titleAm: title,
        bodyEn: body, bodyAm: body, createdAt: now(), readAt: null
      });
    }
  }
};
