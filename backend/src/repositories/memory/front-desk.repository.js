import { randomUUID } from 'node:crypto';
import { addisDate, now } from '../shared.js';

function frontDeskError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function scoped(rows, actor) {
  return rows.filter((row) => row.organizationId === actor.orgId &&
    row.campusId === actor.activeCampusId && !row.archivedAt);
}

function page(rows, query) {
  const offset = (query.page - 1) * query.pageSize;
  return rows.slice(offset, offset + query.pageSize);
}

function byDateRange(value, query) {
  const date = String(value).slice(0, 10);
  return (!query.from || date >= query.from) && (!query.to || date <= query.to);
}

function studentIsScoped(repo, studentId, actor) {
  const student = repo.students.find((row) => row.id === studentId &&
    row.campusId === actor.activeCampusId);
  return student && repo.campuses.some((campus) =>
    campus.id === student.campusId && campus.organizationId === actor.orgId);
}

function staffForUser(repo, actor) {
  return repo.staff.find((staff) => staff.userId === actor.sub &&
    staff.organizationId === actor.orgId && staff.campusId === actor.activeCampusId) ?? null;
}

function matchSearch(row, query, fields) {
  if (!query.search) return true;
  const term = query.search.toLocaleLowerCase();
  return fields.some((field) => String(row[field] ?? '').toLocaleLowerCase().includes(term));
}

export const memoryFrontDeskBundle = {
  initFrontDesk() {
    this.frontDeskVisitors ??= [];
    this.frontDeskAppointments ??= [];
    this.frontDeskMessages ??= [];
    this.frontDeskAuthorizations ??= [];
    this.frontDeskPickupEvents ??= [];
    this.frontDeskPickupAttempts ??= [];
    this.frontDeskDeliveries ??= [];
    this.frontDeskLostFound ??= [];
    this.frontDeskSettings ??= [];
  },
  async listFrontDeskVisitors(query, actor) {
    this.initFrontDesk();
    return page(scoped(this.frontDeskVisitors, actor).filter((row) =>
      (!query.status || row.status === query.status) &&
      byDateRange(row.checkedInAt, query) &&
      matchSearch(row, query, ['visitorName', 'purpose'])).sort((a, b) =>
      b.checkedInAt.localeCompare(a.checkedInAt)), query);
  },
  async createFrontDeskVisitor(data, actor) {
    this.initFrontDesk();
    if (data.hostStaffId && !this.staff.some((row) => row.id === data.hostStaffId &&
        row.organizationId === actor.orgId && row.campusId === actor.activeCampusId &&
        !row.archivedAt)) {
      throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Host staff member not found.', 404);
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'checked_in', checkedInAt: now(), checkedOutAt: null, archivedAt: null,
      createdBy: actor.sub, createdAt: now(), updatedAt: now() };
    this.frontDeskVisitors.push(row);
    await this.appendAudit(actor, 'frontdesk.visitor.checked_in', 'frontdesk_visitor', row.id, null, row);
    const host = data.hostStaffId && this.staff.find((staff) => staff.id === data.hostStaffId &&
      staff.organizationId === actor.orgId && staff.campusId === actor.activeCampusId);
    await this.frontDeskNotify(actor, 'frontdesk.visitor_arrival', row.id,
      'Visitor arrived', `${row.visitorName} checked in.`,
      host?.userId ? [host.userId] : null);
    return structuredClone(row);
  },
  async checkoutFrontDeskVisitor(id, actor) {
    this.initFrontDesk();
    const row = scoped(this.frontDeskVisitors, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'checked_in') throw frontDeskError('FRONTDESK_VISITOR_INVALID_STATE',
      'Only checked-in visitors can check out.');
    const before = structuredClone(row);
    row.status = 'checked_out'; row.checkedOutAt = now(); row.updatedAt = now();
    await this.appendAudit(actor, 'frontdesk.visitor.checked_out', 'frontdesk_visitor', id, before, row);
    return structuredClone(row);
  },
  async listFrontDeskAppointments(query, actor, ownOnly = false) {
    this.initFrontDesk();
    const staff = ownOnly ? staffForUser(this, actor) : null;
    if (ownOnly && !staff) return [];
    return page(scoped(this.frontDeskAppointments, actor).filter((row) =>
      (!ownOnly || row.staffId === staff.id) &&
      (!query.status || row.status === query.status) &&
      byDateRange(row.appointmentAt, query) &&
      matchSearch(row, query, ['parentName', 'purpose'])).sort((a, b) =>
      a.appointmentAt.localeCompare(b.appointmentAt)), query);
  },
  async createFrontDeskAppointment(data, actor) {
    this.initFrontDesk();
    const staff = this.staff.find((row) => row.id === data.staffId &&
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId &&
      !row.archivedAt);
    if (!staff) throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Appointment staff member not found.', 404);
    if (data.studentId && !studentIsScoped(this, data.studentId, actor)) {
      throw frontDeskError('FRONTDESK_STUDENT_NOT_FOUND', 'Student not found in this school.', 404);
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'scheduled', archivedAt: null, createdBy: actor.sub,
      createdAt: now(), updatedAt: now() };
    this.frontDeskAppointments.push(row);
    await this.appendAudit(actor, 'frontdesk.appointment.created', 'frontdesk_appointment', row.id, null, row);
    const recipient = this.users.find((user) => user.id === staff.userId);
    await this.frontDeskNotify(actor, 'frontdesk.appointment', row.id,
      'Appointment scheduled', `${row.parentName} scheduled an appointment.`,
      recipient ? [recipient.id] : null);
    return structuredClone(row);
  },
  async updateFrontDeskAppointmentStatus(id, status, actor) {
    this.initFrontDesk();
    const row = scoped(this.frontDeskAppointments, actor).find((item) => item.id === id);
    if (!row) return null;
    if (!({ scheduled: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'] }
      [row.status] ?? []).includes(status)) {
      throw frontDeskError('FRONTDESK_APPOINTMENT_INVALID_STATE', 'Appointment status transition is invalid.');
    }
    const before = structuredClone(row);
    row.status = status; row.updatedAt = now();
    await this.appendAudit(actor, 'frontdesk.appointment.status_changed',
      'frontdesk_appointment', id, before, row);
    return structuredClone(row);
  },
  async listFrontDeskMessages(query, actor, ownOnly = false) {
    this.initFrontDesk();
    const staff = ownOnly ? staffForUser(this, actor) : null;
    if (ownOnly && !staff) return [];
    return page(scoped(this.frontDeskMessages, actor).filter((row) =>
      (!ownOnly || row.recipientStaffId === staff.id) &&
      (!query.status || row.status === query.status) &&
      matchSearch(row, query, ['senderName', 'subject', 'message']))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), query);
  },
  async createFrontDeskMessage(data, actor) {
    this.initFrontDesk();
    const staff = this.staff.find((row) => row.id === data.recipientStaffId &&
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId &&
      !row.archivedAt);
    if (!staff) throw frontDeskError('FRONTDESK_STAFF_NOT_FOUND', 'Message recipient not found.', 404);
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'new', archivedAt: null, createdBy: actor.sub, createdAt: now(), updatedAt: now() };
    this.frontDeskMessages.push(row);
    await this.appendAudit(actor, 'frontdesk.message.created', 'frontdesk_message', row.id, null, row);
    const recipient = this.users.find((user) => user.id === staff.userId);
    if (recipient) await this.frontDeskNotify(actor, 'frontdesk.message', row.id,
      'Message for staff', `${row.senderName} left a message.`, [recipient.id]);
    return structuredClone(row);
  },
  async updateFrontDeskMessageStatus(id, status, actor, ownOnly = false) {
    this.initFrontDesk();
    const staff = ownOnly ? staffForUser(this, actor) : null;
    const row = scoped(this.frontDeskMessages, actor).find((item) =>
      item.id === id && (!ownOnly || item.recipientStaffId === staff?.id));
    if (!row) return null;
    if (!({ new: ['read'], read: ['resolved'] }[row.status] ?? []).includes(status)) {
      throw frontDeskError('FRONTDESK_MESSAGE_INVALID_STATE', 'Message status transition is invalid.');
    }
    const before = structuredClone(row);
    row.status = status; row.updatedAt = now();
    await this.appendAudit(actor, 'frontdesk.message.status_changed', 'frontdesk_message', id, before, row);
    return structuredClone(row);
  },
  async listFrontDeskAuthorizations(query, actor) {
    this.initFrontDesk();
    return page(scoped(this.frontDeskAuthorizations, actor).filter((row) =>
      (!query.studentId || row.studentId === query.studentId) &&
      (!query.status || row.status === query.status) &&
      (!query.search || row.guardianName.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())))
      .sort((a, b) => a.guardianName.localeCompare(b.guardianName))
      .map((row) => ({ ...row, phone: '' })), query);
  },
  async createFrontDeskAuthorization(data, actor) {
    this.initFrontDesk();
    if (!studentIsScoped(this, data.studentId, actor)) {
      throw frontDeskError('FRONTDESK_STUDENT_NOT_FOUND', 'Student not found in this school.', 404);
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, usedAt: null, status: 'active', createdBy: actor.sub, updatedBy: actor.sub,
      createdAt: now(), updatedAt: now() };
    this.frontDeskAuthorizations.push(row);
    await this.appendAudit(actor, 'frontdesk.pickup.authorization_created',
      'frontdesk_pickup_authorization', row.id, null, row);
    return structuredClone(row);
  },
  async updateFrontDeskAuthorizationStatus(id, status, actor) {
    this.initFrontDesk();
    const row = scoped(this.frontDeskAuthorizations, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'active' || !['removed', 'expired'].includes(status)) {
      throw frontDeskError('FRONTDESK_AUTHORIZATION_INVALID_STATE', 'Authorization status transition is invalid.');
    }
    const before = structuredClone(row);
    row.status = status; row.updatedBy = actor.sub; row.updatedAt = now();
    await this.appendAudit(actor, `frontdesk.pickup.authorization_${status}`,
      'frontdesk_pickup_authorization', id, before, row);
    return structuredClone(row);
  },
  async recordFrontDeskPickup(data, actor) {
    this.initFrontDesk();
    const existing = scoped(this.frontDeskPickupEvents, actor).find((row) =>
      row.eventType === 'release' && row.studentId === data.studentId &&
      row.occasionKey === data.occasionKey);
    if (existing) return { ...structuredClone(existing), refused: false };
    if (!studentIsScoped(this, data.studentId, actor)) {
      throw frontDeskError('FRONTDESK_STUDENT_NOT_FOUND', 'Student not found in this school.', 404);
    }
    const day = addisDate();
    const authorization = scoped(this.frontDeskAuthorizations, actor).find((row) =>
      row.id === data.authorizationId && row.studentId === data.studentId);
    const settings = this.frontDeskSettings.find((row) =>
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId) ??
      { blockAbsentPickup: false, blockReleasedToday: true, securityRoleKey: null };
    let refusal = null;
    if (!authorization || authorization.status !== 'active' ||
        (authorization.expiresAt && authorization.expiresAt <= now()) ||
        (authorization.oneTime && authorization.usedAt) ||
        authorization.guardianName.toLocaleLowerCase() !== data.personName.toLocaleLowerCase()) {
      refusal = 'No active authorization matches this person.';
    } else if (authorization.oneTime && !data.confirmOneTime) {
      refusal = 'A second confirmation is required for this one-time authorization.';
    } else if (settings.blockReleasedToday && scoped(this.frontDeskPickupEvents, actor).some((row) =>
      row.eventType === 'release' && row.studentId === data.studentId && row.releaseDate === day)) {
      refusal = 'The student already has a release recorded today.';
    } else if (settings.blockAbsentPickup && this.attendance.some((record) =>
      record.studentId === data.studentId && record.status === 'absent' &&
      record.attendanceDate === day)) {
      refusal = 'The student is marked absent today.';
    }
    if (refusal) {
      const attempt = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        studentId: data.studentId, personName: data.personName, attemptedBy: actor.sub,
        attemptedAt: now(), reason: refusal, verificationNote: data.verificationNote, createdAt: now() };
      this.frontDeskPickupAttempts.push(attempt);
      await this.appendAudit(actor, 'frontdesk.pickup.refused', 'frontdesk_pickup_attempt',
        attempt.id, null, attempt);
      await this.frontDeskNotify(actor, 'frontdesk.pickup.refused', attempt.id,
        'Pickup verification refused', `${data.personName} was refused pickup for student ${data.studentId}.`,
        null, settings.securityRoleKey);
      return { ...structuredClone(attempt), refused: true };
    }
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      studentId: data.studentId, eventType: 'release', pickedUpBy: data.personName,
      authorizationId: authorization.id, releasedBy: actor.sub, releasedAt: now(),
      releaseDate: day, occasionKey: data.occasionKey,
      activeReleaseKey: `${data.studentId}:${data.occasionKey}`, correctionOf: null,
      note: data.verificationNote, correctionReason: null, createdAt: now() };
    this.frontDeskPickupEvents.push(row);
    if (authorization.oneTime) {
      const before = structuredClone(authorization);
      authorization.usedAt = row.releasedAt; authorization.status = 'expired';
      authorization.updatedBy = actor.sub; authorization.updatedAt = now();
      await this.appendAudit(actor, 'frontdesk.pickup.authorization_consumed',
        'frontdesk_pickup_authorization', authorization.id, before, authorization);
    }
    await this.appendAudit(actor, 'frontdesk.pickup.released', 'frontdesk_pickup_release',
      row.id, null, row);
    return { ...structuredClone(row), refused: false };
  },
  async listFrontDeskPickupEvents(query, actor) {
    this.initFrontDesk();
    return page(scoped(this.frontDeskPickupEvents, actor).filter((row) =>
      byDateRange(row.releasedAt, query) &&
      (!query.search || row.studentId.toLowerCase().includes(query.search.toLowerCase()) ||
        (row.pickedUpBy ?? '').toLowerCase().includes(query.search.toLowerCase())))
      .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt)), query);
  },
  async listFrontDeskPickupAttempts(query, actor) {
    this.initFrontDesk();
    return page(this.frontDeskPickupAttempts.filter((row) =>
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId &&
      byDateRange(row.attemptedAt, query) &&
      (!query.search || row.studentId.toLowerCase().includes(query.search.toLowerCase()) ||
        row.personName.toLowerCase().includes(query.search.toLowerCase())))
      .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt)), query);
  },
  async correctFrontDeskPickup(id, data, actor) {
    this.initFrontDesk();
    const original = scoped(this.frontDeskPickupEvents, actor).find((row) =>
      row.id === id && row.eventType === 'release');
    if (!original) return null;
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      studentId: original.studentId, eventType: 'correction', pickedUpBy: null,
      authorizationId: null, releasedBy: actor.sub, releasedAt: now(),
      releaseDate: original.releaseDate, occasionKey: `correction:${randomUUID()}`,
      activeReleaseKey: null, correctionOf: id, note: data.note,
      correctionReason: data.reason, createdAt: now() };
    this.frontDeskPickupEvents.push(row);
    await this.appendAudit(actor, 'frontdesk.pickup.corrected', 'frontdesk_pickup_release',
      row.id, null, row);
    return structuredClone(row);
  },
  async listFrontDeskDeliveries(query, actor) {
    this.initFrontDesk();
    return page(scoped(this.frontDeskDeliveries, actor).filter((row) =>
      (!query.status || row.status === query.status) &&
      byDateRange(row.receivedAt, query) &&
      matchSearch(row, query, ['recipientName', 'description']))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), query);
  },
  async createFrontDeskDelivery(data, actor) {
    this.initFrontDesk();
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'received', receivedAt: now(), collectedAt: null, createdBy: actor.sub,
      archivedAt: null, createdAt: now(), updatedAt: now() };
    this.frontDeskDeliveries.push(row);
    await this.appendAudit(actor, 'frontdesk.delivery.received', 'frontdesk_delivery', row.id, null, row);
    return structuredClone(row);
  },
  async updateFrontDeskDeliveryStatus(id, status, actor) {
    this.initFrontDesk();
    const row = scoped(this.frontDeskDeliveries, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'received' || !['collected', 'returned'].includes(status)) {
      throw frontDeskError('FRONTDESK_DELIVERY_INVALID_STATE', 'Delivery status transition is invalid.');
    }
    const before = structuredClone(row);
    row.status = status; row.collectedAt = status === 'collected' ? now() : row.collectedAt;
    row.updatedAt = now();
    await this.appendAudit(actor, 'frontdesk.delivery.status_changed', 'frontdesk_delivery', id, before, row);
    return structuredClone(row);
  },
  async listFrontDeskLostFound(query, actor) {
    this.initFrontDesk();
    return page(scoped(this.frontDeskLostFound, actor).filter((row) =>
      (!query.status || row.status === query.status) &&
      byDateRange(row.foundAt, query) &&
      matchSearch(row, query, ['description', 'locationFound', 'claimedBy']))
      .sort((a, b) => b.foundAt.localeCompare(a.foundAt)), query);
  },
  async createFrontDeskLostFound(data, actor) {
    this.initFrontDesk();
    const row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'unclaimed', claimedBy: null, claimedAt: null, createdBy: actor.sub,
      archivedAt: null, createdAt: now(), updatedAt: now() };
    this.frontDeskLostFound.push(row);
    await this.appendAudit(actor, 'frontdesk.lost_found.created', 'frontdesk_lost_found', row.id, null, row);
    return structuredClone(row);
  },
  async updateFrontDeskLostFoundStatus(id, data, actor) {
    this.initFrontDesk();
    const row = scoped(this.frontDeskLostFound, actor).find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== 'unclaimed' || !['claimed', 'disposed'].includes(data.status)) {
      throw frontDeskError('FRONTDESK_LOST_FOUND_INVALID_STATE', 'Lost-and-found status transition is invalid.');
    }
    const before = structuredClone(row);
    row.status = data.status; row.claimedBy = data.status === 'claimed' ? data.claimedBy : null;
    row.claimedAt = data.status === 'claimed' ? now() : null; row.updatedAt = now();
    await this.appendAudit(actor, 'frontdesk.lost_found.status_changed', 'frontdesk_lost_found',
      id, before, row);
    return structuredClone(row);
  },
  async getFrontDeskSettings(actor) {
    this.initFrontDesk();
    return structuredClone(this.frontDeskSettings.find((row) =>
      row.organizationId === actor.orgId && row.campusId === actor.activeCampusId) ??
      { organizationId: actor.orgId, campusId: actor.activeCampusId,
        blockAbsentPickup: false, blockReleasedToday: true, securityRoleKey: null });
  },
  async updateFrontDeskSettings(data, actor) {
    this.initFrontDesk();
    let row = this.frontDeskSettings.find((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    const before = row ? structuredClone(row) : null;
    if (!row) {
      row = { id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        ...data, createdAt: now(), updatedAt: now() };
      this.frontDeskSettings.push(row);
    } else Object.assign(row, data, { updatedAt: now() });
    await this.appendAudit(actor, 'frontdesk.settings.updated', 'frontdesk_settings',
      row.id, before, row);
    return structuredClone(row);
  },
  async getFrontDeskDashboard(actor) {
    this.initFrontDesk();
    const today = addisDate();
    const visitors = scoped(this.frontDeskVisitors, actor);
    const appointments = scoped(this.frontDeskAppointments, actor);
    const messages = scoped(this.frontDeskMessages, actor);
    return {
      visitorsToday: visitors.filter((row) => row.checkedInAt.slice(0, 10) === today).length,
      appointmentsToday: appointments.filter((row) => row.appointmentAt.slice(0, 10) === today).length,
      pendingMessages: messages.filter((row) => row.status === 'new').length
    };
  },
  async frontDeskNotify(actor, sourceType, sourceId, title, body, selectedUserIds = null, securityRoleKey = null) {
    const recipients = this.users.filter((user) => user.orgId === actor.orgId &&
      user.isActive !== false && user.campusIds?.includes(actor.activeCampusId) &&
      (selectedUserIds ? selectedUserIds.includes(user.id) :
        ['principal', 'owner_director', 'system_admin'].includes(user.role) ||
        (securityRoleKey && user.role === securityRoleKey)));
    for (const recipient of recipients) {
      if (this.userNotifications.some((notice) => notice.userId === recipient.id &&
          notice.sourceType === sourceType && notice.sourceId === sourceId)) continue;
      this.userNotifications.unshift({ id: randomUUID(), organizationId: actor.orgId,
        campusId: actor.activeCampusId, userId: recipient.id, sourceType, sourceId,
        titleEn: title, titleAm: title, bodyEn: body, bodyAm: body,
        readAt: null, createdAt: now() });
    }
  }
};
