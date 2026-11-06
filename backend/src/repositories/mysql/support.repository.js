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

function duplicateTicketError() {
  return supportError('SUPPORT_TICKET_DUPLICATE',
    'An active ticket with this subject and category already exists.', 409);
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
  if (mode.startsWith('platform')) {
    if (!['super_admin', 'support_staff'].includes(actor.role)) {
      throw supportError('SUPPORT_FORBIDDEN', 'Platform support access is required.', 403);
    }
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
    if (mode.startsWith('platform')) {
      for (const ticket of rows) await supportAudit(this.db, actor, ticket,
        'support.ticket.cross_school_read', 'support_ticket', ticket.id, null, {
          access: 'list'
        });
    }
    return rows.map(mapTicket);
  },
  async listSupportAssignees() {
    const rows = await this.db('users').whereIn('role', ['super_admin', 'support_staff'])
      .where({ is_active: true }).select('id', 'name').orderBy('name');
    return rows.map((row) => ({ id: row.id, name: row.name }));
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
      const duplicate = await trx('support_tickets').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        ticket_type: ticketType, created_by: actor.sub,
        subject: data.subject, category: data.category
      }).whereIn('status', ['open', 'assigned', 'in_progress', 'waiting_on_school'])
        .forUpdate().first('id');
      if (duplicate) throw duplicateTicketError();
      await trx('support_tickets').insert(row);
      await supportAudit(trx, actor, row, 'support.ticket.created',
        'support_ticket', id, null, mapTicket(row));
      if (ticketType === 'platform') {
        const recipients = await trx('users').whereIn('role', ['super_admin', 'support_staff'])
          .where({ is_active: true })
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
    if (mode.startsWith('platform')) await supportAudit(this.db, actor, row,
      'support.ticket.cross_school_read', 'support_ticket', row.id, null, {
        access: 'detail'
      });
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
      const previousStatus = ticket.status;
      const previousAssignee = ticket.assigned_to;
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
        values.status = data.status;
        if (data.status === 'resolved' && !ticket.resolved_at) {
          values.resolved_at = trx.fn.now();
        }
      }
      if (data.assignedTo !== undefined) {
        if (!mode.startsWith('platform')) {
          throw supportError('SUPPORT_ASSIGNMENT_FORBIDDEN', 'Only platform support can assign tickets.', 403);
        }
        if (data.assignedTo) {
          const assignee = await trx('users').where({ id: data.assignedTo, is_active: true })
            .whereIn('role', ['super_admin', 'support_staff']).first('id');
          if (!assignee) throw supportError('SUPPORT_ASSIGNEE_NOT_FOUND',
            'Active platform support user not found.', 404);
        }
        values.assigned_to = data.assignedTo;
        if (data.status === undefined && data.assignedTo && ticket.status === 'open') {
          values.status = 'assigned';
        }
      }
      await trx('support_tickets').where({ id, organization_id: ticket.organization_id,
        campus_id: ticket.campus_id }).update(values);
      const after = { ...before,
        ...(values.status !== undefined ? { status: values.status } : {}),
        ...(data.assignedTo !== undefined ? { assignedTo: data.assignedTo } : {}),
        ...(values.resolved_at !== undefined && !ticket.resolved_at
          ? { resolvedAt: new Date().toISOString() } : {}) };
      if (data.assignedTo !== undefined && data.assignedTo !== previousAssignee) {
        await supportAudit(trx, actor, ticket, 'support.ticket.assigned',
          'support_ticket', id, before, after);
        await notifyTicket(trx, ticket, 'support.ticket.assigned',
          randomUUID(), 'Support ticket assigned', ticket.subject,
          [data.assignedTo, ticket.created_by]);
      }
      if (values.status !== undefined && values.status !== previousStatus) {
        const action = values.status === 'open' && ['resolved', 'closed'].includes(previousStatus)
          ? 'support.ticket.reopened' : 'support.ticket.status_changed';
        await supportAudit(trx, actor, ticket, action, 'support_ticket', id, before, after);
        await notifyTicket(trx, ticket, action, randomUUID(),
          'Support ticket status changed', `Ticket "${ticket.subject}" is ${values.status}.`,
          [ticket.created_by, data.assignedTo ?? ticket.assigned_to]
            .filter((userId) => userId && userId !== actor.sub));
      }
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
        is_internal: mode.startsWith('platform') && Boolean(data.isInternal), body: data.body
      };
      await trx('support_ticket_comments').insert(comment);
      await supportAudit(trx, actor, ticket, 'support.ticket.comment_added',
        'support_ticket_comment', comment.id, null, comment);
      if (!comment.is_internal) await notifyTicket(trx, ticket, 'support.ticket.comment',
        comment.id, 'New support ticket comment', ticket.subject,
        [ticket.created_by, ticket.assigned_to].filter((userId) => userId && userId !== actor.sub));
      return trx('support_ticket_comments').where({ id: comment.id }).first();
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
    if (mode.startsWith('platform')) await supportAudit(this.db, actor, row,
      'support.ticket.cross_school_read', 'support_ticket', row.ticket_id, null, {
        access: 'attachment', attachmentId: row.id
      });
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
    const [organizations, studentDocs, admissionDocs, assignmentDocs, supportDocs] =
      await Promise.all([
        this.db('organizations').whereNot({ status: 'platform' })
          .select('id', 'name', 'logo_size_bytes').orderBy('name'),
        this.db('student_documents as sd')
          .join('students as s', 's.id', 'sd.student_id')
          .join('campuses as c', 'c.id', 's.campus_id')
          .groupBy('c.organization_id').select('c.organization_id')
          .sum({ total: 'sd.size_bytes' }),
        this.db('admission_documents as ad')
          .join('admissions as a', 'a.id', 'ad.admission_id')
          .join('campuses as c', 'c.id', 'a.campus_id')
          .groupBy('c.organization_id').select('c.organization_id')
          .sum({ total: 'ad.size_bytes' }),
        this.db('assignment_attachments').groupBy('organization_id')
          .select('organization_id').sum({ total: 'size_bytes' }),
        this.db('support_ticket_attachments').groupBy('organization_id')
          .select('organization_id').sum({ total: 'size_bytes' })
      ]);
    const storageTotals = (rows) => new Map(rows.map((row) =>
      [row.organization_id, Number(row.total ?? 0)]));
    const studentTotals = storageTotals(studentDocs);
    const admissionTotals = storageTotals(admissionDocs);
    const assignmentTotals = storageTotals(assignmentDocs);
    const supportTotals = storageTotals(supportDocs);
    const storageBySchool = organizations.map((organization) => ({
      id: organization.id, name: organization.name,
      usedBytes: Number(organization.logo_size_bytes ?? 0) +
        (studentTotals.get(organization.id) ?? 0) +
        (admissionTotals.get(organization.id) ?? 0) +
        (assignmentTotals.get(organization.id) ?? 0) +
        (supportTotals.get(organization.id) ?? 0)
    }));
    const latest = await this.db('system_backup_runs').whereNull('organization_id')
      .whereNull('campus_id').orderBy('started_at', 'desc').first();
    return {
      api: 'ok', database, storageBySchool, runtime,
      backupLatest: latest ? {
        id: latest.id, kind: latest.kind, startedAt: latest.started_at, completedAt: latest.completed_at,
        status: latest.status, sizeBytes: latest.size_bytes == null ? null : Number(latest.size_bytes),
        errorCode: latest.error_code
      } : null
    };
  },
  async createBackupRun() {
    const row = { id: randomUUID(), organization_id: null, campus_id: null,
      kind: 'database', started_at: this.db.fn.now(), status: 'running' };
    await this.db.transaction(async (trx) => {
      await trx('system_backup_runs').insert(row);
      await trx('audit_log').insert(auditRow({
        sub: null, orgId: null, activeCampusId: null
      }, 'platform.backup.recorded', 'system_backup_run', row.id, null, {
        kind: row.kind, status: row.status
      }));
    });
    return { id: row.id };
  },
  async finishBackupRun(id, result) {
    if (!['succeeded', 'failed'].includes(result.status)) {
      throw new Error('Backup result status is invalid.');
    }
    const values = { completed_at: this.db.fn.now(), status: result.status,
      size_bytes: result.sizeBytes ?? null, artifact_name: result.artifactName ?? null,
      error_code: result.errorCode ?? null };
    await this.db.transaction(async (trx) => {
      const before = await trx('system_backup_runs').where({
        id, organization_id: null, campus_id: null, status: 'running'
      }).forUpdate().first();
      if (!before) throw new Error('Active backup run was not found.');
      await trx('system_backup_runs').where({ id }).update(values);
      await trx('audit_log').insert(auditRow({
        sub: null, orgId: null, activeCampusId: null
      }, 'platform.backup.recorded', 'system_backup_run', id, {
        kind: before.kind, status: before.status
      }, {
        kind: before.kind, status: result.status,
        sizeBytes: result.sizeBytes ?? null, errorCode: result.errorCode ?? null
      }));
    });
    return { id, ...result };
  },
  async listBackupRuns(limit = 50) {
    const rows = await this.db('system_backup_runs').whereNull('organization_id')
      .whereNull('campus_id').orderBy('started_at', 'desc').limit(limit);
    return rows.map((row) => ({
      id: row.id, kind: row.kind, startedAt: row.started_at, completedAt: row.completed_at,
      status: row.status, sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      errorCode: row.error_code
    }));
  },
  async getEmailIntegrationStatus(actor, mailInfo) {
    const user = await this.db('users').where({
      id: actor.sub, organization_id: actor.orgId
    }).first('email', 'email_verified_at');
    const last = await this.db('email_integration_tests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('tested_at', 'desc').first('result', 'tested_at', 'error_code');
    return {
      ...mailInfo, emailAddress: user?.email ?? null,
      emailVerified: Boolean(user?.email_verified_at),
      lastTestResult: last ? {
        result: last.result, testedAt: last.tested_at, errorCode: last.error_code
      } : null
    };
  },
  async recordEmailIntegrationTest(actor, result, errorCode = null) {
    const row = {
      id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      requested_by: actor.sub, result, error_code: errorCode, tested_at: this.db.fn.now()
    };
    await this.db('email_integration_tests').insert(row);
    return { id: row.id, result, errorCode, testedAt: row.tested_at };
  },
  async createEmailVerificationToken(actor, tokenHash, expiresAt) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      await trx('user_email_verification_tokens').where({
        organization_id: actor.orgId, user_id: actor.sub
      }).whereNull('used_at').update({ used_at: trx.fn.now() });
      await trx('user_email_verification_tokens').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        user_id: actor.sub, token_hash: tokenHash, expires_at: expiresAt
      });
    });
    return { id };
  },
  async verifyEmailAddress(actor, tokenHash) {
    return this.db.transaction(async (trx) => {
      const token = await trx('user_email_verification_tokens').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        user_id: actor.sub, token_hash: tokenHash
      }).whereNull('used_at').where('expires_at', '>', trx.fn.now()).forUpdate().first();
      if (!token) return false;
      const user = await trx('users').where({
        id: actor.sub, organization_id: actor.orgId
      }).whereNotNull('email').forUpdate().first('id');
      if (!user) return false;
      await trx('user_email_verification_tokens').where({ id: token.id })
        .update({ used_at: trx.fn.now() });
      await trx('users').where({ id: user.id }).update({ email_verified_at: trx.fn.now() });
      await trx('audit_log').insert(auditRow(actor, 'integration.email_verified',
        'user', user.id, null, { emailVerified: true }));
      return true;
    });
  }
};
