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

function modeAllows(ticket, mode, actor) {
  if (mode === 'platform') return actor.role === 'super_admin' && ticket.ticketType === 'platform';
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

export const memorySupportBundle = {
  initSupport() {
    this.supportTickets ??= [];
    this.supportTicketComments ??= [];
    this.supportTicketAttachments ??= [];
    this.backupRuns ??= [];
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
    return rows.slice(offset, offset + query.pageSize).map((ticket) => mapTicket(ticket));
  },
  async createSupportTicket(data, actor, ticketType) {
    this.initSupport();
    const row = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ticketType, subject: data.subject, category: data.category, priority: data.priority,
      status: 'open', createdBy: actor.sub, assignedTo: null, resolvedAt: null,
      createdAt: now(), updatedAt: now()
    };
    this.supportTickets.push(row);
    await this.appendAudit(actor, 'support.ticket.created', 'support_ticket', row.id, null, row);
    if (ticketType === 'platform') {
      const recipients = this.users.filter((user) => user.role === 'super_admin' &&
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
    if (data.status !== undefined) {
      const transitions = {
        open: ['in_progress', 'waiting_school', 'resolved'],
        in_progress: ['waiting_school', 'resolved', 'open'],
        waiting_school: ['in_progress', 'resolved', 'open'],
        resolved: ['open']
      };
      if (!(transitions[ticket.status] ?? []).includes(data.status)) {
        throw supportError('SUPPORT_TICKET_INVALID_STATE', 'Ticket status transition is invalid.');
      }
      ticket.status = data.status;
      ticket.resolvedAt = data.status === 'resolved' ? now() : null;
    }
    if (data.assignedTo !== undefined) {
      if (mode !== 'platform') {
        throw supportError('SUPPORT_ASSIGNMENT_FORBIDDEN', 'Only platform support can assign tickets.', 403);
      }
      const user = this.users.find((row) => row.id === data.assignedTo &&
        row.role === 'super_admin' && row.isActive !== false);
      if (data.assignedTo && !user) {
        throw supportError('SUPPORT_ASSIGNEE_NOT_FOUND', 'Active platform support user not found.', 404);
      }
      ticket.assignedTo = data.assignedTo;
    }
    ticket.updatedAt = now();
    await this.appendAudit({ ...actor, orgId: ticket.organizationId,
      activeCampusId: ticket.campusId }, 'support.ticket.updated', 'support_ticket',
    id, before, ticket);
    await this.supportNotify(ticket, 'support.ticket.updated', `${id}:${ticket.updatedAt}`,
      'Support ticket updated', `Ticket "${ticket.subject}" is ${ticket.status}.`,
      [ticket.createdBy, ticket.assignedTo]);
    return mapTicket(ticket);
  },
  async addSupportComment(id, data, actor, mode) {
    this.initSupport();
    const ticket = this.supportTickets.find((row) => row.id === id && modeAllows(row, mode, actor));
    if (!ticket) return null;
    const row = {
      id: randomUUID(), organizationId: ticket.organizationId, campusId: ticket.campusId,
      ticketId: ticket.id, authorId: actor.sub,
      isInternal: mode === 'platform' && Boolean(data.isInternal),
      body: data.body, createdAt: now()
    };
    this.supportTicketComments.push(row);
    await this.appendAudit({ ...actor, orgId: ticket.organizationId,
      activeCampusId: ticket.campusId }, 'support.ticket.comment_added', 'support_ticket_comment',
    row.id, null, row);
    await this.supportNotify(ticket, 'support.ticket.comment', row.id,
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
        ? Object.fromEntries(Object.entries(this.backupRuns.at(-1))
          .filter(([key]) => key !== 'artifactName')) : null
    };
  },
  async createBackupRun() {
    this.initSupport();
    const row = { id: randomUUID(), organizationId: null, campusId: null,
      startedAt: now(), completedAt: null, status: 'running', sizeBytes: null,
      artifactName: null, errorCode: null };
    this.backupRuns.push(row);
    return structuredClone(row);
  },
  async finishBackupRun(id, result) {
    this.initSupport();
    const row = this.backupRuns.find((item) => item.id === id);
    if (!row) throw new Error('Backup run was not found.');
    Object.assign(row, result);
    return structuredClone(row);
  },
  async listBackupRuns(limit = 50) {
    this.initSupport();
    return this.backupRuns.slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit).map(({ artifactName, ...row }) => row);
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
