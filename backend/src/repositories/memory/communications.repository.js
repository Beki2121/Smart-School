import { randomUUID } from 'node:crypto';
import { campusScopeError, now } from '../shared.js';

export const memoryCommunicationsBundle = {
  async createStaffMessage(data, actor) {
    if (data.departmentId && !this.departments.some((item) =>
      item.id === data.departmentId && item.campusId === actor.activeCampusId)) {
      throw campusScopeError('Department is outside the active campus.');
    }
    const message = {
      id: randomUUID(), campusId: actor.activeCampusId, departmentId: data.departmentId ?? null,
      createdBy: actor.sub, type: data.type, title: data.title, body: data.body, createdAt: now()
    };
    this.staffMessages.unshift(message);
    await this.appendAudit(actor, `staff_message.${data.type}_created`, 'staff_message', message.id, null, message);
    return message;
  },
  async listStaffMessages(actor) {
    const staff = this.staff.find((item) => item.userId === actor.sub && item.campusId === actor.activeCampusId);
    return this.staffMessages.filter((item) =>
      item.campusId === actor.activeCampusId &&
      (!item.departmentId || item.departmentId === staff?.departmentId));
  },
  async listCampusAnnouncements(campusId, organizationId) {
    return this.campusAnnouncements.filter((item) =>
      item.campusId === campusId && item.organizationId === organizationId &&
      new Date(item.publishedAt) <= new Date())
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 100);
  },
  addPortalAudienceNotifications(campusId, sectionId, sourceType, sourceId, titleEn, titleAm, bodyEn, bodyAm) {
    const students = this.students.filter((student) => student.campusId === campusId &&
      student.status === 'enrolled' && !student.archivedAt &&
      (!sectionId || (student.sectionId ?? this.enrolments.find((enrolment) =>
        enrolment.studentId === student.id && enrolment.status === 'active')?.sectionId) === sectionId));
    const recipients = new Set(students.map((student) => student.userId).filter(Boolean));
    const studentIds = new Set(students.map((student) => student.id));
    for (const link of this.studentGuardians.filter((item) =>
      item.isVerified && studentIds.has(item.studentId))) {
      const guardian = this.guardians.find((item) => item.id === link.guardianId);
      if (guardian?.userId) recipients.add(guardian.userId);
    }
    const createdAt = now();
    for (const userId of recipients) this.userNotifications.unshift({
      id: randomUUID(), campusId, userId, sourceType, sourceId,
      titleEn, titleAm, bodyEn, bodyAm, readAt: null, createdAt
    });
  },
  campusNotificationRecipients(campusId) {
    const roles = [
      'owner_director', 'group_executive', 'principal', 'registrar', 'academic_head',
      'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor',
      'system_admin'
    ];
    return this.users.filter((user) =>
      user.isActive !== false && user.campusIds?.includes(campusId) && roles.includes(user.role));
  },
  addCampusNotifications(campusId, sourceType, sourceId, titleEn, titleAm, bodyEn, bodyAm) {
    const createdAt = now();
    for (const user of this.campusNotificationRecipients(campusId)) {
      this.userNotifications.unshift({
        id: randomUUID(), campusId, userId: user.id, sourceType, sourceId,
        titleEn, titleAm, bodyEn, bodyAm, readAt: null, createdAt
      });
    }
  },
  async listUserNotifications(actor) {
    const notifications = this.userNotifications.filter((item) =>
      item.userId === actor.sub && (item.campusId === actor.activeCampusId ||
        (!item.campusId && item.organizationId === actor.orgId)));
    return {
      items: notifications.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
      unreadCount: notifications.filter((item) => !item.readAt).length
    };
  },
  async markUserNotificationRead(id, actor) {
    const notification = this.userNotifications.find((item) =>
      item.id === id && item.userId === actor.sub &&
      (item.campusId === actor.activeCampusId ||
        (!item.campusId && item.organizationId === actor.orgId)));
    if (!notification) return null;
    notification.readAt ??= now();
    return notification;
  },
  async createCampusAnnouncement(data, actor) {
    if (data.sectionId && !this.sections.some((section) =>
      section.id === data.sectionId && section.campusId === actor.activeCampusId)) {
      throw campusScopeError('Section is outside the active campus.');
    }
    const announcement = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId, ...data,
      createdBy: actor.sub, publishedAt: now()
    };
    this.campusAnnouncements.unshift(announcement);
    await this.appendAudit(actor, 'campus_announcement.published', 'campus_announcement',
      announcement.id, null, {
        titleEn: announcement.titleEn, titleAm: announcement.titleAm,
        publishedAt: announcement.publishedAt
      });
    this.addCampusNotifications(
      actor.activeCampusId, 'campus_announcement', announcement.id,
      announcement.titleEn, announcement.titleAm, announcement.bodyEn, announcement.bodyAm
    );
    this.addPortalAudienceNotifications(
      actor.activeCampusId, announcement.sectionId, 'campus_announcement', announcement.id,
      announcement.titleEn, announcement.titleAm, announcement.bodyEn, announcement.bodyAm
    );
    return announcement;
  },
  async listCampusEvents(campusId, from, to, organizationId) {
    return this.campusEvents.filter((item) =>
      item.campusId === campusId && item.organizationId === organizationId &&
      item.status !== 'archived' &&
      item.startsOn <= to && item.endsOn >= from)
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
      .slice(0, 250);
  },
  async createCampusEvent(data, actor) {
    const section = data.sectionId && this.sections.find((item) =>
      item.id === data.sectionId && item.campusId === actor.activeCampusId);
    if (data.sectionId && !section) throw campusScopeError('Section is outside the active campus.');
    const event = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'published', createdAt: now(), createdBy: actor.sub
    };
    this.campusEvents.push(event);
    await this.appendAudit(actor, 'campus_event.created', 'campus_event', event.id, null, event);
    this.addCampusNotifications(
      actor.activeCampusId, 'campus_event', event.id,
      event.titleEn, event.titleAm, event.descriptionEn, event.descriptionAm
    );
    this.addPortalAudienceNotifications(
      actor.activeCampusId, event.sectionId, 'campus_event', event.id,
      event.titleEn, event.titleAm, event.descriptionEn, event.descriptionAm
    );
    return event;
  },
  async updateCampusEventStatus(id, status, actor) {
    const event = this.campusEvents.find((item) =>
      item.id === id && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!event) return null;
    const transitions = { published: ['cancelled', 'archived'], cancelled: ['published', 'archived'], archived: [] };
    if (!transitions[event.status]?.includes(status)) {
      const error = new Error(`Cannot change a ${event.status} event to ${status}.`);
      error.status = 409; error.code = 'CAMPUS_EVENT_TRANSITION_INVALID'; throw error;
    }
    const before = { status: event.status, createdAt: event.createdAt };
    event.status = status;
    await this.appendAudit(actor, 'campus_event.status_changed', 'campus_event',
      id, before, { status, createdAt: event.createdAt });
    return { ...event };
  }
};
