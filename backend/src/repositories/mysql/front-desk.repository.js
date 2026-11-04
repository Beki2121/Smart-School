import { randomUUID } from 'node:crypto';
import { addisDate, auditRow } from '../shared.js';

function frontDeskError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function duplicate(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

function dateTime(value) {
  return value instanceof Date ? value.toISOString() : value == null ? null : String(value);
}

function sqlDateTime(value) {
  const [date, time = ''] = String(value).trim().replace('T', ' ').split(' ');
  const localTime = time.replace(/\.\d+/, '').replace(/(?:Z|[+-]\d{2}:\d{2})$/, '');
  return `${date} ${localTime.length === 5 ? `${localTime}:00` : localTime}`;
}

function dateOnly(value) {
  return value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
}

function mapVisitor(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    visitorName: row.visitor_name, purpose: row.purpose, hostStaffId: row.host_staff_id,
    status: row.status, checkedInAt: dateTime(row.checked_in_at),
    checkedOutAt: dateTime(row.checked_out_at), createdBy: row.created_by,
    createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}
function mapAppointment(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    parentName: row.parent_name, studentId: row.student_id, staffId: row.staff_id,
    appointmentAt: dateTime(row.appointment_at), purpose: row.purpose, status: row.status,
    createdBy: row.created_by, createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}
function mapMessage(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    senderName: row.sender_name, recipientStaffId: row.recipient_staff_id, subject: row.subject,
    message: row.message, status: row.status, createdBy: row.created_by,
    createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}
function mapAuthorization(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    studentId: row.student_id, guardianName: row.guardian_name, relationship: row.relationship,
    phone: row.phone, authorizationType: row.authorization_type, oneTime: Boolean(row.one_time),
    expiresAt: dateTime(row.expires_at), usedAt: dateTime(row.used_at), status: row.status,
    createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}
function mapPickupEvent(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    studentId: row.student_id, eventType: row.event_type, pickedUpBy: row.picked_up_by,
    authorizationId: row.authorization_id, releasedBy: row.released_by,
    releasedAt: dateTime(row.released_at), releaseDate: dateOnly(row.release_date),
    occasionKey: row.occasion_key, correctionOf: row.correction_of, note: row.note,
    correctionReason: row.correction_reason, createdAt: dateTime(row.created_at) };
}
function mapAttempt(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    studentId: row.student_id, personName: row.person_name, attemptedBy: row.attempted_by,
    attemptedAt: dateTime(row.attempted_at), reason: row.reason,
    verificationNote: row.verification_note, createdAt: dateTime(row.created_at) };
}
function mapDelivery(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    recipientStaffId: row.recipient_staff_id, recipientName: row.recipient_name,
    description: row.description, status: row.status, receivedAt: dateTime(row.received_at),
    collectedAt: dateTime(row.collected_at), createdBy: row.created_by,
    createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}
function mapLostFound(row) {
  return { id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    description: row.description, locationFound: row.location_found, status: row.status,
    claimedBy: row.claimed_by, foundAt: dateTime(row.found_at), claimedAt: dateTime(row.claimed_at),
    createdBy: row.created_by, createdAt: dateTime(row.created_at), updatedAt: dateTime(row.updated_at) };
}

async function writeAudit(trx, actor, action, entity, id, before, after) {
  await trx('audit_log').insert(auditRow(actor, action, entity, id, before, after));
}

async function scopedStudent(trx, studentId, actor, lock = false) {
  let query = trx('students as s').join('campuses as c', 'c.id', 's.campus_id')
    .where({ 's.id': studentId, 's.campus_id': actor.activeCampusId,
      'c.organization_id': actor.orgId }).select('s.id', 's.status');
  if (lock) query = query.forUpdate();
  return query.first();
}

async function staffUser(trx, staffId, actor) {
  return trx('staff').where({ id: staffId, organization_id: actor.orgId,
    campus_id: actor.activeCampusId }).whereNull('archived_at').first('id', 'user_id');
}

async function notify(trx, actor, sourceType, sourceId, title, body,
  selectedUserIds = null, securityRoleKey = null) {
  const query = trx('users as u').join('user_campuses as uc', 'uc.user_id', 'u.id')
    .where({ 'u.organization_id': actor.orgId, 'uc.campus_id': actor.activeCampusId,
      'uc.is_active': true, 'u.is_active': true });
  if (selectedUserIds) query.whereIn('u.id', selectedUserIds);
  else query.where((roles) => {
    roles.whereIn('u.role', ['principal', 'owner_director', 'system_admin']);
    if (securityRoleKey) roles.orWhere('u.role', securityRoleKey);
  });
  const recipients = await query.distinct('u.id');
  if (!recipients.length) return;
  await trx('user_notifications').insert(recipients.map(({ id }) => ({
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    user_id: id, source_type: sourceType, source_id: sourceId,
    title_en: title, title_am: title, body_en: body, body_am: body
  }))).onConflict(['user_id', 'source_type', 'source_id']).ignore();
}

function applyListFilters(query, tableAlias, filters, dateColumn = null) {
  if (filters.status) query.where(`${tableAlias}.status`, filters.status);
  if (dateColumn && filters.from) query.where(`${tableAlias}.${dateColumn}`, '>=', filters.from);
  if (dateColumn && filters.to) query.where(`${tableAlias}.${dateColumn}`, '<=', filters.to);
}

export const mysqlFrontDeskBundle = {
  async listFrontDeskVisitors(query, actor) {
    let rows = this.db('frontdesk_visitors').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at');
    applyListFilters(rows, 'frontdesk_visitors', query, 'checked_in_at');
    if (query.search) rows.where((nested) => nested
      .where('visitor_name', 'like', `%${query.search}%`)
      .orWhere('purpose', 'like', `%${query.search}%`));
    return (await rows.orderBy('checked_in_at', 'desc').limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)).map(mapVisitor);
  },
  async createFrontDeskVisitor(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      let host = null;
      if (data.hostStaffId) {
        host = await staffUser(trx, data.hostStaffId, actor);
        if (!host) throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Host staff member not found.', 404);
      }
      const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        visitor_name: data.visitorName, purpose: data.purpose,
        host_staff_id: data.hostStaffId ?? null, status: 'checked_in',
        checked_in_at: trx.fn.now(), checked_out_at: null, created_by: actor.sub };
      await trx('frontdesk_visitors').insert(row);
      const saved = await trx('frontdesk_visitors').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      await writeAudit(trx, actor, 'frontdesk.visitor.checked_in',
        'frontdesk_visitor', id, null, mapVisitor(saved));
      await notify(trx, actor, 'frontdesk.visitor_arrival', id, 'Visitor arrived',
        `${data.visitorName} checked in.`, host?.user_id ? [host.user_id] : null);
    });
    return mapVisitor(await this.db('frontdesk_visitors').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async checkoutFrontDeskVisitor(id, actor) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('frontdesk_visitors').where(scope).forUpdate().first();
      if (!row || row.archived_at) return null;
      if (row.status !== 'checked_in') throw frontDeskError('FRONTDESK_VISITOR_INVALID_STATE',
        'Only checked-in visitors can check out.');
      await trx('frontdesk_visitors').where(scope).update({
        status: 'checked_out', checked_out_at: trx.fn.now(), updated_at: trx.fn.now()
      });
      await writeAudit(trx, actor, 'frontdesk.visitor.checked_out',
        'frontdesk_visitor', id, mapVisitor(row), { ...mapVisitor(row), status: 'checked_out' });
      return true;
    });
    return result ? mapVisitor(await this.db('frontdesk_visitors').where(scope).first()) : null;
  },
  async listFrontDeskAppointments(query, actor, ownOnly = false) {
    let rows = this.db('frontdesk_appointments as a')
      .join('campuses as c', 'c.id', 'a.campus_id')
      .where({ 'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId,
        'c.organization_id': actor.orgId }).whereNull('a.archived_at');
    if (ownOnly) {
      const staff = await this.db('staff').where({ user_id: actor.sub,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).whereNull('archived_at').first('id');
      if (!staff) return [];
      rows.where('a.staff_id', staff.id);
    }
    if (query.status) rows.where('a.status', query.status);
    if (query.search) rows.where((nested) => nested.where('a.parent_name', 'like', `%${query.search}%`)
      .orWhere('a.purpose', 'like', `%${query.search}%`));
    if (query.from) rows.where('a.appointment_at', '>=', query.from);
    if (query.to) rows.where('a.appointment_at', '<=', `${query.to} 23:59:59`);
    return (await rows.select('a.*').orderBy('a.appointment_at')
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(mapAppointment);
  },
  async createFrontDeskAppointment(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      const staff = await staffUser(trx, data.staffId, actor);
      if (!staff) throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Appointment staff member not found.', 404);
      if (data.studentId && !await scopedStudent(trx, data.studentId, actor)) {
        throw frontDeskError('FRONTDESK_STUDENT_NOT_FOUND', 'Student not found in this school.', 404);
      }
      const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        parent_name: data.parentName, student_id: data.studentId ?? null, staff_id: data.staffId,
        appointment_at: sqlDateTime(data.appointmentAt), purpose: data.purpose,
        status: 'scheduled', created_by: actor.sub };
      await trx('frontdesk_appointments').insert(row);
      await writeAudit(trx, actor, 'frontdesk.appointment.created',
        'frontdesk_appointment', id, null, row);
      if (staff.user_id) await notify(trx, actor, 'frontdesk.appointment', id,
        'Appointment scheduled', `${data.parentName} scheduled an appointment.`, [staff.user_id]);
    });
    return mapAppointment(await this.db('frontdesk_appointments').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateFrontDeskAppointmentStatus(id, status, actor) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('frontdesk_appointments').where(scope).forUpdate().first();
      if (!row || row.archived_at) return null;
      if (!({ scheduled: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] }
        [row.status] ?? []).includes(status)) {
        throw frontDeskError('FRONTDESK_APPOINTMENT_INVALID_STATE', 'Appointment status transition is invalid.');
      }
      await trx('frontdesk_appointments').where(scope).update({ status, updated_at: trx.fn.now() });
      await writeAudit(trx, actor, 'frontdesk.appointment.status_changed',
        'frontdesk_appointment', id, mapAppointment(row), { ...mapAppointment(row), status });
      return true;
    });
    return result ? mapAppointment(await this.db('frontdesk_appointments').where(scope).first()) : null;
  },
  async listFrontDeskMessages(query, actor, ownOnly = false) {
    let rows = this.db('frontdesk_messages as m')
      .join('campuses as c', 'c.id', 'm.campus_id')
      .where({ 'm.organization_id': actor.orgId, 'm.campus_id': actor.activeCampusId,
        'c.organization_id': actor.orgId }).whereNull('m.archived_at');
    if (ownOnly) {
      const staff = await this.db('staff').where({ user_id: actor.sub,
        organization_id: actor.orgId, campus_id: actor.activeCampusId }).whereNull('archived_at').first('id');
      if (!staff) return [];
      rows.where('m.recipient_staff_id', staff.id);
    }
    if (query.status) rows.where('m.status', query.status);
    if (query.search) rows.where((nested) => nested.where('m.sender_name', 'like', `%${query.search}%`)
      .orWhere('m.subject', 'like', `%${query.search}%`).orWhere('m.message', 'like', `%${query.search}%`));
    return (await rows.select('m.*').orderBy('m.created_at', 'desc')
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(mapMessage);
  },
  async createFrontDeskMessage(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      const staff = await staffUser(trx, data.recipientStaffId, actor);
      if (!staff) throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Message recipient not found.', 404);
      const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        sender_name: data.senderName, recipient_staff_id: data.recipientStaffId,
        subject: data.subject, message: data.message, status: 'new', created_by: actor.sub };
      await trx('frontdesk_messages').insert(row);
      await writeAudit(trx, actor, 'frontdesk.message.created', 'frontdesk_message', id, null, row);
      if (staff.user_id) await notify(trx, actor, 'frontdesk.message', id,
        'Message for staff', `${data.senderName} left a message.`, [staff.user_id]);
    });
    return mapMessage(await this.db('frontdesk_messages').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateFrontDeskMessageStatus(id, status, actor, ownOnly = false) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      let rowQuery = trx('frontdesk_messages').where(scope).forUpdate();
      if (ownOnly) {
        const staff = await trx('staff').where({ user_id: actor.sub,
          organization_id: actor.orgId, campus_id: actor.activeCampusId }).whereNull('archived_at').first('id');
        if (!staff) return null;
        rowQuery = rowQuery.where('recipient_staff_id', staff.id);
      }
      const row = await rowQuery.first();
      if (!row || row.archived_at) return null;
      if (!({ new: ['read'], read: ['resolved'] }[row.status] ?? []).includes(status)) {
        throw frontDeskError('FRONTDESK_MESSAGE_INVALID_STATE', 'Message status transition is invalid.');
      }
      await trx('frontdesk_messages').where(scope).update({ status, updated_at: trx.fn.now() });
      await writeAudit(trx, actor, 'frontdesk.message.status_changed', 'frontdesk_message',
        id, mapMessage(row), { ...mapMessage(row), status });
      return true;
    });
    return result ? mapMessage(await this.db('frontdesk_messages').where(scope).first()) : null;
  },
  async listFrontDeskAuthorizations(query, actor) {
    let rows = this.db('frontdesk_pickup_authorizations').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (query.studentId) rows.where('student_id', query.studentId);
    if (query.status) rows.where('status', query.status);
    if (query.search) rows.where('guardian_name', 'like', `%${query.search}%`);
    return (await rows.orderBy('guardian_name').limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)).map((row) => ({
      ...mapAuthorization(row), phone: ''
    }));
  },
  async createFrontDeskAuthorization(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      if (!await scopedStudent(trx, data.studentId, actor)) {
        throw frontDeskError('FRONTDESK_STUDENT_NOT_FOUND', 'Student not found in this school.', 404);
      }
      const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        student_id: data.studentId, guardian_name: data.guardianName,
        relationship: data.relationship, phone: data.phone, authorization_type: data.authorizationType,
        one_time: data.oneTime, expires_at: data.expiresAt ? sqlDateTime(data.expiresAt) : null,
        used_at: null, status: 'active', created_by: actor.sub, updated_by: actor.sub };
      await trx('frontdesk_pickup_authorizations').insert(row);
      await writeAudit(trx, actor, 'frontdesk.pickup.authorization_created',
        'frontdesk_pickup_authorization', id, null, row);
    });
    return mapAuthorization(await this.db('frontdesk_pickup_authorizations').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateFrontDeskAuthorizationStatus(id, status, actor) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('frontdesk_pickup_authorizations').where(scope).forUpdate().first();
      if (!row) return null;
      if (row.status !== 'active' || !['removed', 'expired'].includes(status)) {
        throw frontDeskError('FRONTDESK_AUTHORIZATION_INVALID_STATE', 'Authorization status transition is invalid.');
      }
      await trx('frontdesk_pickup_authorizations').where(scope)
        .update({ status, updated_by: actor.sub, updated_at: trx.fn.now() });
      await writeAudit(trx, actor, `frontdesk.pickup.authorization_${status}`,
        'frontdesk_pickup_authorization', id, mapAuthorization(row),
        { ...mapAuthorization(row), status, updatedBy: actor.sub });
      return true;
    });
    return result ? mapAuthorization(await this.db('frontdesk_pickup_authorizations').where(scope).first()) : null;
  },
  async recordFrontDeskPickup(data, actor) {
    const day = addisDate();
    try {
      const result = await this.db.transaction(async (trx) => {
      const student = await scopedStudent(trx, data.studentId, actor, true);
      if (!student) throw frontDeskError('FRONTDESK_STUDENT_NOT_FOUND',
        'Student not found in this school.', 404);
      const repeated = await trx('frontdesk_pickup_events').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        student_id: data.studentId, occasion_key: data.occasionKey, event_type: 'release'
      }).first();
      if (repeated) return { id: repeated.id, refused: false };
      const settings = await trx('frontdesk_settings').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first() ?? { block_absent_pickup: false, block_released_today: true, security_role_key: null };
      const authorization = await trx('frontdesk_pickup_authorizations').where({
        id: data.authorizationId, organization_id: actor.orgId,
        campus_id: actor.activeCampusId, student_id: data.studentId
      }).forUpdate().first();
      let refusal = null;
      if (!authorization || authorization.status !== 'active' ||
          (authorization.expires_at && new Date(authorization.expires_at) <= new Date()) ||
          (authorization.one_time && authorization.used_at) ||
          authorization.guardian_name.trim().toLocaleLowerCase() !== data.personName.toLocaleLowerCase()) {
        refusal = 'No active authorization matches this person.';
      } else if (authorization.one_time && !data.confirmOneTime) {
        refusal = 'A second confirmation is required for this one-time authorization.';
      } else if (settings.block_absent_pickup) {
        const absent = await trx('attendance_records as ar')
          .join('attendance_sessions as asn', 'asn.id', 'ar.session_id')
          .join('campuses as c', 'c.id', 'asn.campus_id')
          .where({ 'ar.student_id': data.studentId, 'ar.status': 'absent',
            'asn.campus_id': actor.activeCampusId, 'asn.attendance_date': day,
            'c.organization_id': actor.orgId }).first('ar.student_id');
        if (absent) refusal = 'The student is marked absent today.';
      }
      if (!refusal && settings.block_released_today) {
        const earlierRelease = await trx('frontdesk_pickup_events').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          student_id: data.studentId, release_date: day, event_type: 'release'
        }).first('id');
        if (earlierRelease) refusal = 'The student already has a release recorded today.';
      }
      if (refusal) {
        const id = randomUUID();
        const attempt = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          student_id: data.studentId, person_name: data.personName, attempted_by: actor.sub,
          attempted_at: trx.fn.now(), reason: refusal, verification_note: data.verificationNote };
        await trx('frontdesk_pickup_attempts').insert(attempt);
        const savedAttempt = await trx('frontdesk_pickup_attempts').where({
          id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).first();
        await writeAudit(trx, actor, 'frontdesk.pickup.refused',
          'frontdesk_pickup_attempt', id, null, mapAttempt(savedAttempt));
        await notify(trx, actor, 'frontdesk.pickup.refused', id,
          'Pickup verification refused', `${data.personName} was refused pickup for student ${data.studentId}.`,
          null, settings.security_role_key);
        return { id, refused: true };
      }
      const id = randomUUID();
      const activeReleaseKey = `${data.studentId}:${data.occasionKey}`;
      const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        student_id: data.studentId, event_type: 'release', picked_up_by: data.personName,
        authorization_id: authorization.id, released_by: actor.sub, released_at: trx.fn.now(),
        release_date: day, occasion_key: data.occasionKey, active_release_key: activeReleaseKey,
        correction_of: null, note: data.verificationNote, correction_reason: null };
      await trx('frontdesk_pickup_events').insert(row);
      const savedEvent = await trx('frontdesk_pickup_events').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      if (authorization.one_time) {
        const before = mapAuthorization(authorization);
        await trx('frontdesk_pickup_authorizations').where({
          id: authorization.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).update({ used_at: trx.fn.now(), status: 'expired', updated_by: actor.sub,
          updated_at: trx.fn.now() });
        await writeAudit(trx, actor, 'frontdesk.pickup.authorization_consumed',
          'frontdesk_pickup_authorization', authorization.id, before,
          { ...before, status: 'expired', updatedBy: actor.sub });
      }
      await writeAudit(trx, actor, 'frontdesk.pickup.released',
        'frontdesk_pickup_release', id, null, mapPickupEvent(savedEvent));
      return { id, refused: false };
      });
      if (!result.refused) {
        const event = await this.db('frontdesk_pickup_events').where({
          id: result.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
        }).first();
        return { ...mapPickupEvent(event), refused: false };
      }
      const attempt = await this.db('frontdesk_pickup_attempts').where({
        id: result.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      return { ...mapAttempt(attempt), refused: true };
    } catch (error) {
      if (duplicate(error)) {
        const repeated = await this.db('frontdesk_pickup_events').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          student_id: data.studentId, occasion_key: data.occasionKey, event_type: 'release'
        }).first();
        if (repeated) return { ...mapPickupEvent(repeated), refused: false };
        throw frontDeskError('FRONTDESK_PICKUP_ALREADY_RELEASED',
          'The student already has a release recorded today.');
      }
      throw error;
    }
  },
  async listFrontDeskPickupEvents(query, actor) {
    let rows = this.db('frontdesk_pickup_events as e').join('campuses as c', 'c.id', 'e.campus_id')
      .where({ 'e.organization_id': actor.orgId, 'e.campus_id': actor.activeCampusId,
        'c.organization_id': actor.orgId });
    if (query.from) rows.where('e.released_at', '>=', query.from);
    if (query.to) rows.where('e.released_at', '<=', `${query.to} 23:59:59`);
    if (query.search) rows.where((nested) => nested.where('e.student_id', 'like', `%${query.search}%`)
      .orWhere('e.picked_up_by', 'like', `%${query.search}%`));
    return (await rows.select('e.*').orderBy('e.released_at', 'desc')
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(mapPickupEvent);
  },
  async correctFrontDeskPickup(id, data, actor) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const newId = randomUUID();
    const result = await this.db.transaction(async (trx) => {
      const original = await trx('frontdesk_pickup_events').where(scope)
        .where('event_type', 'release').forUpdate().first();
      if (!original) return null;
      const row = { id: newId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        student_id: original.student_id, event_type: 'correction', picked_up_by: null,
        authorization_id: null, released_by: actor.sub, released_at: trx.fn.now(),
        release_date: original.release_date, occasion_key: `correction:${newId}`,
        active_release_key: null, correction_of: id, note: data.note, correction_reason: data.reason };
      await trx('frontdesk_pickup_events').insert(row);
      const saved = await trx('frontdesk_pickup_events').where({
        id: newId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      await writeAudit(trx, actor, 'frontdesk.pickup.corrected', 'frontdesk_pickup_release',
        newId, null, mapPickupEvent(saved));
      return true;
    });
    return result ? mapPickupEvent(await this.db('frontdesk_pickup_events').where({
      id: newId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first()) : null;
  },
  async listFrontDeskPickupAttempts(query, actor) {
    let rows = this.db('frontdesk_pickup_attempts as a').join('campuses as c', 'c.id', 'a.campus_id')
      .where({ 'a.organization_id': actor.orgId, 'a.campus_id': actor.activeCampusId,
        'c.organization_id': actor.orgId });
    if (query.from) rows.where('a.attempted_at', '>=', query.from);
    if (query.to) rows.where('a.attempted_at', '<=', `${query.to} 23:59:59`);
    return (await rows.select('a.*').orderBy('a.attempted_at', 'desc')
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(mapAttempt);
  },
  async listFrontDeskDeliveries(query, actor) {
    let rows = this.db('frontdesk_deliveries').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at');
    applyListFilters(rows, 'frontdesk_deliveries', query, 'received_at');
    if (query.search) rows.where((nested) => nested.where('recipient_name', 'like', `%${query.search}%`)
      .orWhere('description', 'like', `%${query.search}%`));
    return (await rows.orderBy('received_at', 'desc').limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)).map(mapDelivery);
  },
  async createFrontDeskDelivery(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      if (data.recipientStaffId && !await staffUser(trx, data.recipientStaffId, actor)) {
        throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Delivery recipient not found.', 404);
      }
      const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        recipient_staff_id: data.recipientStaffId ?? null, recipient_name: data.recipientName,
        description: data.description, status: 'received', received_at: trx.fn.now(),
        collected_at: null, created_by: actor.sub };
      await trx('frontdesk_deliveries').insert(row);
      const saved = await trx('frontdesk_deliveries').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first();
      await writeAudit(trx, actor, 'frontdesk.delivery.received',
        'frontdesk_delivery', id, null, mapDelivery(saved));
    });
    return mapDelivery(await this.db('frontdesk_deliveries').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateFrontDeskDeliveryStatus(id, status, actor) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('frontdesk_deliveries').where(scope).forUpdate().first();
      if (!row || row.archived_at) return null;
      if (row.status !== 'received' || !['collected', 'returned'].includes(status)) {
        throw frontDeskError('FRONTDESK_DELIVERY_INVALID_STATE', 'Delivery status transition is invalid.');
      }
      await trx('frontdesk_deliveries').where(scope).update({
        status, ...(status === 'collected' ? { collected_at: trx.fn.now() } : {}),
        updated_at: trx.fn.now()
      });
      await writeAudit(trx, actor, 'frontdesk.delivery.status_changed', 'frontdesk_delivery',
        id, mapDelivery(row), { ...mapDelivery(row), status });
      return true;
    });
    return result ? mapDelivery(await this.db('frontdesk_deliveries').where(scope).first()) : null;
  },
  async listFrontDeskLostFound(query, actor) {
    let rows = this.db('frontdesk_lost_found').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereNull('archived_at');
    if (query.status) rows.where('status', query.status);
    if (query.from) rows.where('found_at', '>=', query.from);
    if (query.to) rows.where('found_at', '<=', `${query.to} 23:59:59`);
    if (query.search) rows.where((nested) => nested.where('description', 'like', `%${query.search}%`)
      .orWhere('location_found', 'like', `%${query.search}%`));
    return (await rows.orderBy('found_at', 'desc').limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)).map(mapLostFound);
  },
  async createFrontDeskLostFound(data, actor) {
    const id = randomUUID();
    const row = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      description: data.description, location_found: data.locationFound,
      status: 'unclaimed', claimed_by: null, found_at: sqlDateTime(data.foundAt),
      claimed_at: null, created_by: actor.sub };
    await this.db.transaction(async (trx) => {
      await trx('frontdesk_lost_found').insert(row);
      await writeAudit(trx, actor, 'frontdesk.lost_found.created', 'frontdesk_lost_found', id, null, row);
    });
    return mapLostFound(await this.db('frontdesk_lost_found').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first());
  },
  async updateFrontDeskLostFoundStatus(id, data, actor) {
    const scope = { id, organization_id: actor.orgId, campus_id: actor.activeCampusId };
    const result = await this.db.transaction(async (trx) => {
      const row = await trx('frontdesk_lost_found').where(scope).forUpdate().first();
      if (!row || row.archived_at) return null;
      if (row.status !== 'unclaimed' || !['claimed', 'disposed'].includes(data.status)) {
        throw frontDeskError('FRONTDESK_LOST_FOUND_INVALID_STATE', 'Lost-and-found status transition is invalid.');
      }
      const updates = { status: data.status, claimed_by: data.status === 'claimed' ? data.claimedBy : null,
        claimed_at: data.status === 'claimed' ? trx.fn.now() : null, updated_at: trx.fn.now() };
      await trx('frontdesk_lost_found').where(scope).update(updates);
      await writeAudit(trx, actor, 'frontdesk.lost_found.status_changed', 'frontdesk_lost_found',
        id, mapLostFound(row), { ...mapLostFound(row), status: data.status,
          claimedBy: updates.claimed_by });
      return true;
    });
    return result ? mapLostFound(await this.db('frontdesk_lost_found').where(scope).first()) : null;
  },
  async getFrontDeskSettings(actor) {
    const row = await this.db('frontdesk_settings').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    return row ? { organizationId: row.organization_id, campusId: row.campus_id,
      blockAbsentPickup: Boolean(row.block_absent_pickup),
      blockReleasedToday: Boolean(row.block_released_today), securityRoleKey: row.security_role_key }
      : { organizationId: actor.orgId, campusId: actor.activeCampusId,
        blockAbsentPickup: false, blockReleasedToday: true, securityRoleKey: null };
  },
  async updateFrontDeskSettings(data, actor) {
    const where = { organization_id: actor.orgId, campus_id: actor.activeCampusId };
    let row;
    await this.db.transaction(async (trx) => {
      const before = await trx('frontdesk_settings').where(where).forUpdate().first();
      if (before) await trx('frontdesk_settings').where(where).update({
        block_absent_pickup: data.blockAbsentPickup,
        block_released_today: data.blockReleasedToday, security_role_key: data.securityRoleKey,
        updated_at: trx.fn.now()
      });
      else await trx('frontdesk_settings').insert({ id: randomUUID(), ...where,
        block_absent_pickup: data.blockAbsentPickup,
        block_released_today: data.blockReleasedToday, security_role_key: data.securityRoleKey });
      row = await trx('frontdesk_settings').where(where).first();
      await writeAudit(trx, actor, 'frontdesk.settings.updated', 'frontdesk_settings',
        row.id, before, row);
    });
    return this.getFrontDeskSettings(actor);
  },
  async getFrontDeskDashboard(actor) {
    const today = addisDate();
    const visitorsToday = Number((await this.db('frontdesk_visitors').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'checked_in'
    }).whereRaw('DATE(checked_in_at) = ?', [today]).count({ total: '*' }))[0].total);
    const appointmentsToday = Number((await this.db('frontdesk_appointments').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).whereRaw('DATE(appointment_at) = ?', [today]).count({ total: '*' }))[0].total);
    const pendingMessages = Number((await this.db('frontdesk_messages').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'new'
    }).count({ total: '*' }))[0].total);
    return { visitorsToday, appointmentsToday, pendingMessages };
  }
};
