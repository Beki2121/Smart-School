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
  async listCampusAnnouncements(campusId) {
    const rows = await this.db('campus_announcements').where({ campus_id: campusId })
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
    const row = {
      id, campus_id: actor.activeCampusId, title_en: data.titleEn, title_am: data.titleAm,
      body_en: data.bodyEn, body_am: data.bodyAm, created_by: actor.sub
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
    });
    const saved = await this.db('campus_announcements').where({ id }).first();
    return mapCampusAnnouncement(saved);
  },
  async listCampusEvents(campusId, from, to) {
    const rows = await this.db('campus_events').where({ campus_id: campusId })
      .where('starts_on', '<=', to).where('ends_on', '>=', from)
      .orderBy('starts_on').orderBy('starts_at').limit(250);
    return rows.map(mapCampusEvent);
  },
  async createCampusEvent(data, actor) {
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId,
      title_en: data.titleEn, title_am: data.titleAm,
      description_en: data.descriptionEn, description_am: data.descriptionAm,
      starts_on: data.startsOn, ends_on: data.endsOn,
      starts_at: data.startsAt ?? null, ends_at: data.endsAt ?? null,
      location: data.location ?? '', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('campus_events').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'campus_event.created', 'campus_event', id, null, data));
      await this.addCampusNotifications(
        trx, actor.activeCampusId, 'campus_event', id,
        data.titleEn, data.titleAm, data.descriptionEn ?? '', data.descriptionAm ?? ''
      );
    });
    return mapCampusEvent(await this.db('campus_events').where({ id }).first());
  }
};
