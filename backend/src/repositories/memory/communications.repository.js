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
  async listCampusAnnouncements(campusId) {
    return this.campusAnnouncements.filter((item) =>
      item.campusId === campusId && new Date(item.publishedAt) <= new Date())
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 100);
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
      item.campusId === actor.activeCampusId && item.userId === actor.sub);
    return {
      items: notifications.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
      unreadCount: notifications.filter((item) => !item.readAt).length
    };
  },
  async markUserNotificationRead(id, actor) {
    const notification = this.userNotifications.find((item) =>
      item.id === id && item.campusId === actor.activeCampusId && item.userId === actor.sub);
    if (!notification) return null;
    notification.readAt ??= now();
    return notification;
  },
  async createCampusAnnouncement(data, actor) {
    const announcement = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data,
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
    return announcement;
  },
  async listCampusEvents(campusId, from, to) {
    return this.campusEvents.filter((item) =>
      item.campusId === campusId && item.startsOn <= to && item.endsOn >= from)
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
      .slice(0, 250);
  },
  async createCampusEvent(data, actor) {
    const event = { id: randomUUID(), campusId: actor.activeCampusId, ...data, createdBy: actor.sub };
    this.campusEvents.push(event);
    await this.appendAudit(actor, 'campus_event.created', 'campus_event', event.id, null, event);
    this.addCampusNotifications(
      actor.activeCampusId, 'campus_event', event.id,
      event.titleEn, event.titleAm, event.descriptionEn, event.descriptionAm
    );
    return event;
  }
};
