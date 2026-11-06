import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { auditRow } from '../shared.js';

const attachmentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain']);

function supportError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function cleanName(value) {
  return path.basename(String(value ?? 'attachment')).replace(/[^\w .()-]/g, '_').slice(0, 180) ||
    'attachment';
}

function mapTicket(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    ticketType: row.ticket_type, subject: row.subject, category: row.category,
    priority: row.priority, status: row.status, createdBy: row.created_by,
    assignedTo: row.assigned_to, resolvedAt: row.resolved_at,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function allowedTicket(query, mode, actor, table = 'support_tickets') {
  if (mode === 'platform') {
    if (actor.role !== 'super_admin') throw supportError('SUPPORT_FORBIDDEN', 'Platform support access is required.', 403);
    query.where(`${table}.ticket_type`, 'platform');
  } else {
    query.where(`${table}.organization_id`, actor.orgId)
      .where(`${table}.campus_id`, actor.activeCampusId)
      .where(`${table}.ticket_type`, mode === 'internal' ? 'internal' : 'platform');
  }
  return query;
}

async function notifyTicket(trx, ticket, sourceType, sourceId, title, body, recipientIds = []) {
  const ids = [...new Set(recipientIds.filter(Boolean))];
  if (!ids.length) return;
  await trx('user_notifications').insert(ids.map((userId) => ({
    id: randomUUID(), organization_id: ticket.organization_id, campus_id: ticket.campus_id,
    user_id: userId, source_type: sourceType, source_id: sourceId,
    title_en: title, title_am: title, body_en: body, body_am: body
  }))).onConflict(['user_id', 'source_type', 'source_id']).ignore();
}

async function supportAudit(trx, actor, ticket, action, entity, entityId, before, after) {
  await trx('audit_log').insert(auditRow({
    ...actor, orgId: ticket.organization_id, activeCampusId: ticket.campus_id
  }, action, entity, entityId, before, after));
}

export const mysqlSupportBundle = {
  async listSupportTickets(filters, actor, mode) {
    let query = allowedTicket(this.db('support_tickets'), mode, actor);
    if (filters.status) query.where('status', filters.status);
    if (filters.priority) query.where('priority', filters.priority);
    if (filters.search) query.where((builder) => builder
      .where('subject', 'like', `%${filters.search}%`)
      .orWhere('category', 'like', `%${filters.search}%`));
    const rows = await query.orderBy('created_at', 'desc').limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
    return rows.map(mapTicket);
  },
  async createSupportTicket(data, actor, ticketType) {
    const id = randomUUID();
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      ticket_type: ticketType, subject: data.subject, category: data.category,
      priority: data.priority, status: 'open', created_by: actor.sub,
      assigned_to: null, resolved_at: null
    };
    await this.db.transaction(async (trx) => {
      await trx('support_tickets').insert(row);
      await supportAudit(trx, actor, row, 'support.ticket.created',
        'support_ticket', id, null, mapTicket(row));
      if (ticketType === 'platform') {
        const recipients = await trx('users').where({ role: 'super_admin', is_active: true })
          .select('id');
        await notifyTicket(trx, row, 'support.ticket.created', id,
          'Support ticket received', row.subject, recipients.map((user) => user.id));
      }
    });
    return mapTicket(await this.db('support_tickets').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async getSupportTicket(id, actor, mode) {
    const row = await allowedTicket(this.db('support_tickets'), mode, actor)
      .where('support_tickets.id', id).first();
    if (!row) return null;
    const ticket = mapTicket(row);
    let comments = this.db('support_ticket_comments').where({
      organization_id: row.organization_id, ticket_id: id
    }).orderBy('created_at');
    if (row.campus_id) comments.where('campus_id', row.campus_id);
    if (mode !== 'platform') comments.where('is_internal', false);
    const attachments = await this.db('support_ticket_attachments').where({
      organization_id: row.organization_id, ticket_id: id
    }).modify((builder) => {
      if (row.campus_id) builder.where('campus_id', row.campus_id);
    }).select('id', 'ticket_id', 'uploaded_by', 'original_name', 'mime_type',
      'size_bytes', 'sha256', 'created_at');
    return {
      ...ticket,
      comments: (await comments).map((comment) => ({
        id: comment.id, authorId: comment.author_id, body: comment.body,
        isInternal: Boolean(comment.is_internal), createdAt: comment.created_at
      })),
      attachments: attachments.map((attachment) => ({
        id: attachment.id, ticketId: attachment.ticket_id, uploadedBy: attachment.uploaded_by,
        originalName: attachment.original_name, mimeType: attachment.mime_type,
        sizeBytes: Number(attachment.size_bytes), sha256: attachment.sha256,
        createdAt: attachment.created_at
      }))
    };
  },
  async updateSupportTicket(id, data, actor, mode) {
    const outcome = await this.db.transaction(async (trx) => {
      const query = allowedTicket(trx('support_tickets'), mode, actor)
        .where('support_tickets.id', id).forUpdate();
      const ticket = await query.first();
      if (!ticket) return null;
      const before = mapTicket(ticket);
      const values = { updated_at: trx.fn.now() };
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
        values.status = data.status;
        values.resolved_at = data.status === 'resolved' ? trx.fn.now() : null;
      }
      if (data.assignedTo !== undefined) {
        if (mode !== 'platform') {
          throw supportError('SUPPORT_ASSIGNMENT_FORBIDDEN', 'Only platform support can assign tickets.', 403);
        }
        if (data.assignedTo) {
          const assignee = await trx('users').where({
            id: data.assignedTo, role: 'super_admin', is_active: true
          }).first('id');
          if (!assignee) throw supportError('SUPPORT_ASSIGNEE_NOT_FOUND',
            'Active platform support user not found.', 404);
        }
        values.assigned_to = data.assignedTo;
      }
      await trx('support_tickets').where({ id, organization_id: ticket.organization_id,
        campus_id: ticket.campus_id }).update(values);
      const after = { ...before, ...(data.status !== undefined ? { status: data.status,
        resolvedAt: data.status === 'resolved' ? new Date().toISOString() : null } : {}),
      ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}) };
      await supportAudit(trx, actor, ticket, 'support.ticket.updated',
        'support_ticket', id, before, after);
      await notifyTicket(trx, ticket, 'support.ticket.updated', `${id}:${Date.now()}`,
        'Support ticket updated', `Ticket "${ticket.subject}" is ${data.status ?? ticket.status}.`,
        [ticket.created_by, data.assignedTo ?? ticket.assigned_to]
          .filter((userId) => userId && userId !== actor.sub));
      return { organizationId: ticket.organization_id, campusId: ticket.campus_id };
    });
    return outcome ? mapTicket(await this.db('support_tickets').where({
      id, organization_id: outcome.organizationId, campus_id: outcome.campusId
    }).first()) : null;
  },
  async addSupportComment(id, data, actor, mode) {
    const result = await this.db.transaction(async (trx) => {
      const ticket = await allowedTicket(trx('support_tickets'), mode, actor)
        .where('support_tickets.id', id).forUpdate().first();
      if (!ticket) return null;
      const comment = {
        id: randomUUID(), organization_id: ticket.organization_id, campus_id: ticket.campus_id,
        ticket_id: ticket.id, author_id: actor.sub,
        is_internal: mode === 'platform' && Boolean(data.isInternal), body: data.body
      };
      await trx('support_ticket_comments').insert(comment);
      await supportAudit(trx, actor, ticket, 'support.ticket.comment_added',
        'support_ticket_comment', comment.id, null, comment);
      await notifyTicket(trx, ticket, 'support.ticket.comment', comment.id,
        'New support ticket comment', ticket.subject,
        [ticket.created_by, ticket.assigned_to].filter((userId) => userId && userId !== actor.sub));
      return comment;
    });
    return result ? {
      id: result.id, authorId: result.author_id, body: result.body,
      isInternal: Boolean(result.is_internal), createdAt: result.created_at
    } : null;
  },
  async addSupportAttachment(id, data, actor, mode) {
    if (!Buffer.isBuffer(data.content) || !data.content.length || data.content.length > 5 * 1024 * 1024 ||
        !attachmentTypes.has(data.mimeType)) {
      throw supportError('SUPPORT_ATTACHMENT_INVALID', 'Attachment must be a PDF, PNG, JPEG, or text file up to 5 MB.', 400);
    }
    const result = await this.db.transaction(async (trx) => {
      const ticket = await allowedTicket(trx('support_tickets'), mode, actor)
        .where('support_tickets.id', id).forUpdate().first();
      if (!ticket) return null;
      await this.assertStorageCapacity(ticket.organization_id, data.content.length, 0, trx);
      const row = {
        id: randomUUID(), organization_id: ticket.organization_id,
        campus_id: ticket.campus_id, ticket_id: ticket.id, uploaded_by: actor.sub,
        original_name: cleanName(data.originalName), mime_type: data.mimeType,
        size_bytes: data.content.length, sha256: createHash('sha256').update(data.content).digest('hex'),
        content: data.content
      };
      await trx('support_ticket_attachments').insert(row);
      await supportAudit(trx, actor, ticket, 'support.ticket.attachment_added',
        'support_ticket_attachment', row.id, null, {
          ...row, content: undefined, organizationId: ticket.organization_id,
          campusId: ticket.campus_id
        });
      return row;
    });
    if (!result) return null;
    const { content, ...row } = result;
    return {
      id: row.id, ticketId: row.ticket_id, uploadedBy: row.uploaded_by,
      originalName: row.original_name, mimeType: row.mime_type, sizeBytes: row.size_bytes,
      sha256: row.sha256, createdAt: row.created_at
    };
  },
  async getSupportAttachment(id, actor, mode) {
    const row = await allowedTicket(this.db('support_ticket_attachments as attachment')
      .join('support_tickets as ticket', 'ticket.id', 'attachment.ticket_id'),
    mode, actor, 'ticket')
      .where('attachment.id', id)
      .whereColumn('attachment.organization_id', 'ticket.organization_id')
      .whereColumn('attachment.campus_id', 'ticket.campus_id')
      .select('attachment.*').first();
    if (!row) return null;
    return {
      id: row.id, ticketId: row.ticket_id, uploadedBy: row.uploaded_by,
      originalName: row.original_name, mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes), sha256: row.sha256, content: row.content
    };
  },
  async checkDatabaseConnectivity() {
    try {
      await this.db.raw('SELECT 1 AS reachable');
      return { reachable: true, mode: 'mysql' };
    } catch (error) {
      return { reachable: false, mode: 'mysql', errorCode: error.code ?? 'DATABASE_UNAVAILABLE' };
    }
  },
  async getPlatformMonitoringSnapshot(runtime) {
    const database = await this.checkDatabaseConnectivity();
    if (!database.reachable) {
      return { api: 'ok', database, storageBySchool: [], runtime, backupLatest: null };
    }
    const organizations = await this.db('organizations').whereNot({ status: 'platform' })
      .select('id', 'name').orderBy('name');
    const storageBySchool = await Promise.all(organizations.map(async (organization) => ({
      id: organization.id, name: organization.name,
      usedBytes: await this.getOrganizationStorageUsage(organization.id)
    })));
    const latest = await this.db('system_backup_runs').orderBy('started_at', 'desc').first();
    return {
      api: 'ok', database, storageBySchool, runtime,
      backupLatest: latest ? {
        id: latest.id, startedAt: latest.started_at, completedAt: latest.completed_at,
        status: latest.status, sizeBytes: latest.size_bytes == null ? null : Number(latest.size_bytes),
        errorCode: latest.error_code
      } : null
    };
  },
  async createBackupRun() {
    const row = { id: randomUUID(), organization_id: null, campus_id: null,
      started_at: this.db.fn.now(), status: 'running' };
    await this.db('system_backup_runs').insert(row);
    return { id: row.id };
  },
  async finishBackupRun(id, result) {
    const values = { completed_at: this.db.fn.now(), status: result.status,
      size_bytes: result.sizeBytes ?? null, artifact_name: result.artifactName ?? null,
      error_code: result.errorCode ?? null };
    const updated = await this.db('system_backup_runs').where({
      id, organization_id: null, campus_id: null
    }).update(values);
    if (!updated) throw new Error('Backup run was not found.');
    return { id, ...result };
  },
  async listBackupRuns(limit = 50) {
    const rows = await this.db('system_backup_runs').whereNull('organization_id')
      .whereNull('campus_id').orderBy('started_at', 'desc').limit(limit);
    return rows.map((row) => ({
      id: row.id, startedAt: row.started_at, completedAt: row.completed_at,
      status: row.status, sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      errorCode: row.error_code
    }));
  }
};
