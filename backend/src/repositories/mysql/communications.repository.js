import { randomUUID } from 'node:crypto';
import { mapCampusAnnouncement, mapCampusEvent, mapUserNotification } from '../communications.mappers.js';
import { auditRow, campusScopeError } from '../shared.js';

export const mysqlCommunicationsBundle = {
  async createStaffMessage(data, actor) {
    if (data.departmentId && !await this.db('departments').where({
      id: data.departmentId, campus_id: actor.activeCampusId
    }).first()) throw campusScopeError('Department is outside the active campus.');
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, department_id: data.departmentId ?? null,
      created_by: actor.sub, message_type: data.type, title: data.title, body: data.body
    };
    await this.db.transaction(async (trx) => {
      await trx('staff_messages').insert(row);
      await trx('audit_log').insert(auditRow(actor, `staff_message.${data.type}_created`, 'staff_message', id, null, data));
    });
    return {
      id, campusId: actor.activeCampusId, departmentId: row.department_id,
      createdBy: actor.sub, type: data.type, title: data.title, body: data.body
    };
  },
  async listStaffMessages(actor) {
    const own = await this.db('staff').where({
      campus_id: actor.activeCampusId, user_id: actor.sub
    }).whereNull('archived_at').first();
    const query = this.db('staff_messages').where({ campus_id: actor.activeCampusId });
    if (own?.department_id) query.where((builder) =>
      builder.whereNull('department_id').orWhere('department_id', own.department_id));
    else if (!['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(actor.role)) {
      query.whereNull('department_id');
    }
    const rows = await query.orderBy('created_at', 'desc').limit(200);
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, departmentId: row.department_id,
      createdBy: row.created_by, type: row.message_type, title: row.title, body: row.body,
      createdAt: row.created_at
    }));
  },
  async listCampusAnnouncements(campusId, organizationId) {
    const rows = await this.db('campus_announcements').where({
      organization_id: organizationId, campus_id: campusId
    })
      .where('published_at', '<=', this.db.fn.now()).orderBy('published_at', 'desc').limit(100);
    return rows.map(mapCampusAnnouncement);
  },
  async addCampusNotifications(trx, campusId, sourceType, sourceId, titleEn, titleAm, bodyEn, bodyAm) {
    const recipients = await trx('user_campuses as uc')
      .join('users as u', 'u.id', 'uc.user_id')
      .where({
        'uc.campus_id': campusId, 'uc.is_active': true, 'u.is_active': true
      })
      .whereIn('u.role', [
        'owner_director', 'group_executive', 'principal', 'registrar', 'academic_head',
        'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor',
        'system_admin'
      ])
      .select('u.id');
    for (let offset = 0; offset < recipients.length; offset += 500) {
      const rows = recipients.slice(offset, offset + 500).map(({ id: userId }) => ({
        id: randomUUID(), campus_id: campusId, user_id: userId, source_type: sourceType,
        source_id: sourceId, title_en: titleEn, title_am: titleAm, body_en: bodyEn, body_am: bodyAm
      }));
      if (rows.length) await trx('user_notifications').insert(rows);
    }
  },
  async addPortalAudienceNotifications(trx, actor, sectionId, sourceType, sourceId,
    titleEn, titleAm, bodyEn, bodyAm) {
    const students = trx('students as s').where({
      's.campus_id': actor.activeCampusId, 's.status': 'enrolled'
    }).whereNull('s.archived_at');
    if (sectionId) students.join('enrolments as e', 'e.student_id', 's.id')
      .where({ 'e.section_id': sectionId, 'e.status': 'active' });
    const rows = await students.select('s.id', 's.user_id');
    const studentIds = rows.map((row) => row.id);
    const recipientIds = new Set(rows.map((row) => row.user_id).filter(Boolean));
    if (studentIds.length) {
      const guardians = await trx('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .whereIn('sg.student_id', studentIds).where({
          'sg.is_verified': true, 'g.organization_id': actor.orgId
        }).whereNotNull('g.user_id').select('g.user_id');
      for (const guardian of guardians) recipientIds.add(guardian.user_id);
    }
    for (const userId of recipientIds) {
      await trx('user_notifications').insert({
        id: randomUUID(), campus_id: actor.activeCampusId, user_id: userId,
        source_type: sourceType, source_id: sourceId,
        title_en: titleEn, title_am: titleAm, body_en: bodyEn, body_am: bodyAm
      });
    }
  },
  async listUserNotifications(actor) {
    const inboxScope = (query) => query.where((builder) => builder
      .where('campus_id', actor.activeCampusId)
      .orWhere('organization_id', actor.orgId));
    const [rows, count] = await Promise.all([
      inboxScope(this.db('user_notifications').where({ user_id: actor.sub }))
        .orderBy('created_at', 'desc').limit(50),
      inboxScope(this.db('user_notifications').where({ user_id: actor.sub }))
        .whereNull('read_at').count({ total: '*' }).first()
    ]);
    return { items: rows.map(mapUserNotification), unreadCount: Number(count.total) };
  },
  async markUserNotificationRead(id, actor) {
    const query = this.db('user_notifications').where({ id, user_id: actor.sub })
      .where((builder) => builder.where('campus_id', actor.activeCampusId)
        .orWhere('organization_id', actor.orgId));
    if (!await query.first()) return null;
    await query.whereNull('read_at').update({ read_at: this.db.fn.now() });
    return mapUserNotification(await this.db('user_notifications').where({
      id, user_id: actor.sub
    }).where((builder) => builder.where('campus_id', actor.activeCampusId)
      .orWhere('organization_id', actor.orgId)).first());
  },
  async createCampusAnnouncement(data, actor) {
    const id = randomUUID();
    if (data.sectionId && !await this.db('sections').where({
      id: data.sectionId, campus_id: actor.activeCampusId
    }).first('id')) throw campusScopeError('Section is outside the active campus.');
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      title_en: data.titleEn, title_am: data.titleAm,
      body_en: data.bodyEn, body_am: data.bodyAm, created_by: actor.sub,
      audience: data.audience, section_id: data.sectionId
    };
    await this.db.transaction(async (trx) => {
      await trx('campus_announcements').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'campus_announcement.published',
        'campus_announcement', id, null, {
          titleEn: data.titleEn, titleAm: data.titleAm
        }));
      await this.addCampusNotifications(
        trx, actor.activeCampusId, 'campus_announcement', id,
        data.titleEn, data.titleAm, data.bodyEn, data.bodyAm
      );
      await this.addPortalAudienceNotifications(
        trx, actor, data.sectionId, 'campus_announcement', id,
        data.titleEn, data.titleAm, data.bodyEn, data.bodyAm
      );
    });
    const saved = await this.db('campus_announcements').where({ id }).first();
    return mapCampusAnnouncement(saved);
  },
  async listCampusEvents(campusId, from, to, organizationId) {
    const rows = await this.db('campus_events').where({
      organization_id: organizationId, campus_id: campusId
    })
      .whereNot('status', 'archived')
      .where('starts_on', '<=', to).where('ends_on', '>=', from)
      .orderBy('starts_on').orderBy('starts_at').limit(250);
    return rows.map(mapCampusEvent);
  },
  async createCampusEvent(data, actor) {
    const id = randomUUID();
    if (data.sectionId && !await this.db('sections').where({
      id: data.sectionId, campus_id: actor.activeCampusId
    }).first('id')) throw campusScopeError('Section is outside the active campus.');
    const row = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      title_en: data.titleEn, title_am: data.titleAm,
      description_en: data.descriptionEn, description_am: data.descriptionAm,
      starts_on: data.startsOn, ends_on: data.endsOn,
      starts_at: data.startsAt ?? null, ends_at: data.endsAt ?? null,
      location: data.location ?? '', created_by: actor.sub, event_type: data.eventType,
      audience: data.audience, section_id: data.sectionId, status: 'published'
    };
    await this.db.transaction(async (trx) => {
      await trx('campus_events').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'campus_event.created', 'campus_event', id, null, data));
      await this.addCampusNotifications(
        trx, actor.activeCampusId, 'campus_event', id,
        data.titleEn, data.titleAm, data.descriptionEn ?? '', data.descriptionAm ?? ''
      );
      await this.addPortalAudienceNotifications(
        trx, actor, data.sectionId, 'campus_event', id,
        data.titleEn, data.titleAm, data.descriptionEn ?? '', data.descriptionAm ?? ''
      );
    });
    return mapCampusEvent(await this.db('campus_events').where({ id }).first());
  },
  async updateCampusEventStatus(id, status, actor) {
    return this.db.transaction(async (trx) => {
      const event = await trx('campus_events').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!event) return null;
      const transitions = { published: ['cancelled', 'archived'], cancelled: ['published', 'archived'], archived: [] };
      if (!transitions[event.status]?.includes(status)) {
        const error = new Error(`Cannot change a ${event.status} event to ${status}.`);
        error.status = 409; error.code = 'CAMPUS_EVENT_TRANSITION_INVALID'; throw error;
      }
      await trx('campus_events').where({ id }).update({ status });
      await trx('audit_log').insert(auditRow(actor, 'campus_event.status_changed',
        'campus_event', id, { status: event.status, createdAt: event.created_at },
        { status, createdAt: event.created_at }));
      return mapCampusEvent({ ...event, status });
    });
  }
};
