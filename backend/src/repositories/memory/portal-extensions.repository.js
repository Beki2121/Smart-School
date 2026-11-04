import { randomUUID } from 'node:crypto';
import { campusScopeError, now } from '../shared.js';

const officeRoles = ['owner_director', 'principal', 'registrar', 'system_admin'];
const staffRoles = [...officeRoles, 'academic_head', 'homeroom_teacher', 'subject_teacher'];

export const memoryPortalExtensionsBundle = {
  portalStudentsFor(actor) {
    if (actor.role === 'student') {
      return this.students.filter((student) => student.userId === actor.sub &&
        student.orgId === actor.orgId && student.campusId === actor.activeCampusId &&
        student.status === 'enrolled' && !student.archivedAt).map((student) => ({
        ...student, sectionId: student.sectionId ?? this.enrolments.find((enrolment) =>
          enrolment.studentId === student.id && enrolment.status === 'active')?.sectionId ?? null
      }));
    }
    if (actor.role === 'parent_guardian') {
      const guardian = this.guardians.find((item) =>
        item.userId === actor.sub && item.orgId === actor.orgId);
      if (!guardian) return [];
      const linkedIds = new Set(this.studentGuardians.filter((link) =>
        link.guardianId === guardian.id && link.isVerified).map((link) => link.studentId));
      return this.students.filter((student) =>
        linkedIds.has(student.id) && student.orgId === actor.orgId &&
        student.campusId === actor.activeCampusId && !student.archivedAt).map((student) => ({
        ...student, sectionId: student.sectionId ?? this.enrolments.find((enrolment) =>
          enrolment.studentId === student.id && enrolment.status === 'active')?.sectionId ?? null
      }));
    }
    return [];
  },
  async getPortalCalendar(actor, range) {
    const students = this.portalStudentsFor(actor);
    const sectionIds = new Set(students.map((student) => student.sectionId).filter(Boolean));
    const announcements = this.campusAnnouncements.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.audience !== 'class' || (item.organizationId === actor.orgId &&
        item.campusId === actor.activeCampusId && sectionIds.has(item.sectionId)));
    const events = this.campusEvents.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      item.status === 'published' && item.startsOn <= range.to && item.endsOn >= range.from &&
      (item.audience !== 'class' || sectionIds.has(item.sectionId)));
    const timetable = this.teachingAssignments.filter((item) =>
      item.campusId === actor.activeCampusId && item.isActive && sectionIds.has(item.sectionId))
      .map((item) => ({
        id: item.id, sectionId: item.sectionId, subjectId: item.subjectId,
        dayOfWeek: item.dayOfWeek, periodNumber: item.periodNumber, roomId: item.roomId,
        subjectName: this.subjects.find((subject) => subject.id === item.subjectId)?.nameEn ?? '',
        teacherName: this.staff.find((staff) => staff.id === item.staffId)?.givenNameEn ?? '',
        teacherUserId: this.staff.find((staff) => staff.id === item.staffId)?.userId
      })).sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) ||
        (a.periodNumber ?? 0) - (b.periodNumber ?? 0));
    return {
      students: students.map((student) => ({
        id: student.id, name: `${student.givenNameEn} ${student.fatherNameEn}`.trim(),
        sectionId: student.sectionId, sectionName: student.sectionName
      })),
      announcements: announcements.slice().sort((a, b) =>
        String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 100),
      events: events.slice().sort((a, b) => a.startsOn.localeCompare(b.startsOn)).slice(0, 200),
      timetable
    };
  },
  async createPortalRequest(data, actor) {
    const student = this.portalStudentsFor(actor).find((item) => item.id === data.studentId);
    if (!student) throw campusScopeError('The selected student is not linked to this account.');
    const request = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      requesterId: actor.sub, studentId: student.id, type: data.type,
      subject: data.subject, details: data.details, status: 'pending',
      handledBy: null, response: null, createdAt: now(), statusChangedAt: null
    };
    this.portalRequests.unshift(request);
    await this.appendAudit(actor, 'portal.request_created', 'portal_request', request.id, null, request);
    this.addOfficeNotifications(actor.activeCampusId, 'portal_request', request.id, request.subject);
    return { ...request };
  },
  addOfficeNotifications(campusId, sourceType, sourceId, title) {
    const createdAt = now();
    for (const user of this.users.filter((item) =>
      item.isActive !== false && item.campusIds?.includes(campusId) && officeRoles.includes(item.role))) {
      this.userNotifications.unshift({
        id: randomUUID(), campusId, userId: user.id, sourceType, sourceId,
        titleEn: title, titleAm: title, bodyEn: title, bodyAm: title,
        readAt: null, createdAt
      });
    }
  },
  async listPortalRequests(actor) {
    const rows = this.portalRequests.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (officeRoles.includes(actor.role) || item.requesterId === actor.sub));
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  },
  async updatePortalRequest(id, data, actor) {
    const request = this.portalRequests.find((item) =>
      item.id === id && item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!request) return null;
    if (!officeRoles.includes(actor.role)) throw campusScopeError('Only the school office can handle requests.');
    const transitions = { pending: ['approved', 'rejected'], approved: ['completed'], rejected: [], completed: [] };
    if (!transitions[request.status]?.includes(data.status)) {
      const error = new Error(`Cannot change a ${request.status} request to ${data.status}.`);
      error.status = 409; error.code = 'PORTAL_REQUEST_TRANSITION_INVALID'; throw error;
    }
    const before = { status: request.status, response: request.response, handledBy: request.handledBy };
    Object.assign(request, {
      status: data.status, response: data.response, handledBy: actor.sub, statusChangedAt: now()
    });
    await this.appendAudit(actor, 'portal.request_status_changed', 'portal_request', id, before, {
      status: request.status, response: request.response
    });
    const requester = this.users.find((item) => item.id === request.requesterId);
    if (requester) this.userNotifications.unshift({
      id: randomUUID(), campusId: actor.activeCampusId, userId: requester.id,
      sourceType: 'portal_request_status', sourceId: id, titleEn: 'Request status updated',
      titleAm: 'የጥያቄ ሁኔታ ተዘምኗል', bodyEn: request.status, bodyAm: request.status,
      readAt: null, createdAt: now()
    });
    return { ...request };
  },
  async createPortalSupportRequest(data, actor) {
    const student = this.portalStudentsFor(actor).find((item) =>
      !data.studentId || item.id === data.studentId);
    if (!student) throw campusScopeError('The selected student is not linked to this account.');
    const request = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      requesterId: actor.sub, studentId: student.id, category: data.category,
      subject: data.subject, details: data.details, status: 'open',
      assignedTo: null, response: null, createdAt: now(), statusChangedAt: null
    };
    this.supportRequests.unshift(request);
    await this.appendAudit(actor, 'portal.support_created', 'support_request', request.id, null, request);
    this.addOfficeNotifications(actor.activeCampusId, 'support_request', request.id, request.subject);
    return { ...request };
  },
  async listPortalSupportRequests(actor) {
    let rows = this.supportRequests.filter((item) =>
      item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
      (item.requesterId === actor.sub || officeRoles.includes(actor.role) || actor.role === 'academic_head'));
    if (['homeroom_teacher', 'subject_teacher'].includes(actor.role)) {
      const studentIds = new Set(this.students.filter((student) => {
        const sectionId = student.sectionId ?? this.enrolments.find((enrolment) =>
          enrolment.studentId === student.id && enrolment.status === 'active')?.sectionId;
        const staff = this.staff.find((item) => item.userId === actor.sub &&
          item.campusId === actor.activeCampusId);
        return staff && this.teachingAssignments.some((assignment) =>
          assignment.staffId === staff.id && assignment.sectionId === sectionId && assignment.isActive);
      }).map((student) => student.id));
      rows = rows.filter((item) => item.requesterId === actor.sub || studentIds.has(item.studentId));
    }
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
  },
  async updatePortalSupportRequest(id, data, actor) {
    const request = this.supportRequests.find((item) =>
      item.id === id && item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
    if (!request) return null;
    if (!staffRoles.includes(actor.role)) throw campusScopeError('Only assigned school staff can handle support requests.');
    const transitions = { open: ['in_progress', 'resolved', 'closed'], in_progress: ['resolved', 'closed'], resolved: ['closed'], closed: [] };
    if (!transitions[request.status]?.includes(data.status)) {
      const error = new Error(`Cannot change a ${request.status} support request to ${data.status}.`);
      error.status = 409; error.code = 'PORTAL_SUPPORT_TRANSITION_INVALID'; throw error;
    }
    const before = { status: request.status, response: request.response };
    Object.assign(request, { status: data.status, response: data.response, assignedTo: actor.sub, statusChangedAt: now() });
    await this.appendAudit(actor, 'portal.support_status_changed', 'support_request', id, before, {
      status: request.status, response: request.response
    });
    return { ...request };
  },
  async isPortalMessagingEnabled(organizationId) {
    return this.organizations.find((item) => item.id === organizationId)?.messagingEnabled !== false;
  },
  async setPortalMessagingEnabled(enabled, actor) {
    const organization = this.organizations.find((item) => item.id === actor.orgId);
    if (!organization) return null;
    const before = { messagingEnabled: organization.messagingEnabled !== false };
    organization.messagingEnabled = enabled;
    await this.appendAudit(actor, 'portal.messaging_setting_changed', 'organization', actor.orgId,
      before, { messagingEnabled: enabled });
    return { messagingEnabled: enabled };
  },
  async listPortalMessageThreads(actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const moderator = ['owner_director', 'principal', 'system_admin'].includes(actor.role);
    const threadIds = new Set(this.threadParticipants.filter((item) => item.userId === actor.sub)
      .map((item) => item.threadId));
    return this.messageThreads.filter((thread) =>
      thread.organizationId === actor.orgId && thread.campusId === actor.activeCampusId &&
      (moderator || threadIds.has(thread.id))).map((thread) => {
      const participants = this.threadParticipants.filter((item) => item.threadId === thread.id);
      const messages = this.portalMessages.filter((item) =>
        item.threadId === thread.id && item.status === 'visible');
      return {
        ...thread, participants: participants.map((item) => ({
          userId: item.userId, role: item.role,
          name: this.users.find((user) => user.id === item.userId)?.name ?? ''
        })),
        unreadCount: messages.filter((item) => item.senderId !== actor.sub &&
          !participants.find((participant) => participant.userId === actor.sub)?.readAt).length,
        messages
      };
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  },
  async createPortalMessageThread(data, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const student = this.students.find((item) => item.id === data.studentId &&
      item.orgId === actor.orgId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    const sectionId = student.sectionId ?? this.enrolments.find((enrolment) =>
      enrolment.studentId === student.id && enrolment.status === 'active')?.sectionId;
    let parentId; let teacherId;
    if (actor.role === 'parent_guardian') {
      const parent = this.guardians.find((item) => item.userId === actor.sub && item.orgId === actor.orgId);
      const link = this.studentGuardians.find((item) =>
        item.guardianId === parent?.id && item.studentId === student.id && item.isVerified);
      if (!link || !data.recipientId) throw campusScopeError('The student is not linked to this parent.');
      const teacher = this.staff.find((item) =>
        item.userId === data.recipientId && item.campusId === actor.activeCampusId);
      const assigned = this.teachingAssignments.some((item) =>
        item.staffId === teacher?.id && item.sectionId === sectionId && item.isActive);
      if (!teacher || !assigned) throw campusScopeError('Teacher is not assigned to this student.');
      parentId = actor.sub; teacherId = data.recipientId;
    } else {
      const teacher = this.staff.find((item) => item.userId === actor.sub &&
        item.campusId === actor.activeCampusId);
      const assigned = this.teachingAssignments.some((item) =>
        item.staffId === teacher?.id && item.sectionId === sectionId && item.isActive);
      const parent = this.guardians.find((item) => item.userId === data.recipientId &&
        item.orgId === actor.orgId);
      const linked = this.studentGuardians.some((item) =>
        item.guardianId === parent?.id && item.studentId === student.id && item.isVerified);
      if (!assigned || !parent || !linked) throw campusScopeError('The teacher is not assigned to this student or the parent is not linked.');
      parentId = data.recipientId; teacherId = actor.sub;
    }
    let thread = this.messageThreads.find((item) =>
      item.studentId === student.id && item.parentId === parentId && item.teacherId === teacherId);
    if (!thread) {
      thread = {
        id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
        studentId: student.id, parentId, teacherId, status: 'open', createdAt: now()
      };
      this.messageThreads.unshift(thread);
      this.threadParticipants.push(
        { threadId: thread.id, userId: parentId, role: 'parent_guardian', readAt: null },
        { threadId: thread.id, userId: teacherId, role: 'teacher', readAt: null }
      );
    }
    await this.appendAudit(actor, 'portal.message_thread_created', 'message_thread', thread.id, null, {
      studentId: student.id, recipientId: actor.sub === parentId ? teacherId : parentId
    });
    return this.sendPortalMessage(thread.id, data.body, actor);
  },
  async sendPortalMessage(threadId, body, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const thread = this.messageThreads.find((item) =>
      item.id === threadId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.status === 'open');
    const participant = this.threadParticipants.find((item) =>
      item.threadId === threadId && item.userId === actor.sub);
    if (!thread || (!participant && !['owner_director', 'principal', 'system_admin'].includes(actor.role))) {
      throw campusScopeError('Message thread is not available to this account.');
    }
    const message = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      threadId, senderId: actor.sub, body, status: 'visible', sentAt: now(),
      moderatedBy: null, moderatedAt: null
    };
    this.portalMessages.unshift(message);
    for (const item of this.threadParticipants.filter((row) => row.threadId === threadId)) {
      if (item.userId !== actor.sub) item.readAt = null;
    }
    await this.appendAudit(actor, 'portal.message_sent', 'message', message.id, null, {
      threadId, bodyLength: body.length
    });
    const recipient = this.threadParticipants.find((item) =>
      item.threadId === threadId && item.userId !== actor.sub);
    if (recipient) this.userNotifications.unshift({
      id: randomUUID(), campusId: actor.activeCampusId, userId: recipient.userId,
      sourceType: 'portal_message', sourceId: message.id, titleEn: 'New parent-teacher message',
      titleAm: 'አዲስ የወላጅ-መምህር መልዕክት', bodyEn: body.slice(0, 120), bodyAm: body.slice(0, 120),
      readAt: null, createdAt: message.sentAt
    });
    return { ...message };
  },
  async markPortalThreadRead(threadId, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const participant = this.threadParticipants.find((item) =>
      item.threadId === threadId && item.userId === actor.sub);
    const thread = this.messageThreads.find((item) =>
      item.id === threadId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!participant || !thread) return null;
    participant.readAt = now();
    return { threadId, readAt: participant.readAt };
  },
  async moderatePortalMessage(messageId, data, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const message = this.portalMessages.find((item) =>
      item.id === messageId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!message) return null;
    const before = { status: message.status };
    Object.assign(message, { status: data.status, moderatedBy: actor.sub, moderatedAt: now() });
    await this.appendAudit(actor, 'portal.message_moderated', 'message', messageId, before, {
      status: message.status, reason: data.reason
    });
    return { ...message };
  }
};
