import { createHash, randomUUID } from 'node:crypto';
import { auditRow, campusScopeError } from '../shared.js';

const officeRoles = ['owner_director', 'principal', 'registrar', 'system_admin'];
const staffRoles = [...officeRoles, 'academic_head', 'homeroom_teacher', 'subject_teacher'];

function threadKey(studentId, parentId, teacherId) {
  return createHash('sha256').update(`${studentId}:${parentId}:${teacherId}`).digest('hex');
}

function mapRequest(row) {
  return {
    id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
    requesterId: row.requester_id, studentId: row.student_id, type: row.type,
    category: row.category, subject: row.subject, details: row.details, status: row.status,
    handledBy: row.handled_by ?? row.assigned_to ?? null, response: row.response ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    statusChangedAt: row.status_changed_at instanceof Date
      ? row.status_changed_at.toISOString() : row.status_changed_at ?? null
  };
}

export const mysqlPortalExtensionsBundle = {
  async portalStudentRows(actor, query = this.db) {
    if (actor.role === 'student') {
      return query('students as s')
        .join('campuses as c', 'c.id', 's.campus_id')
        .leftJoin('enrolments as e', function joinActiveEnrolment() {
          this.on('e.student_id', 's.id').andOnVal('e.status', '=', 'active');
        })
        .where({
          'c.organization_id': actor.orgId, 's.campus_id': actor.activeCampusId,
          's.user_id': actor.sub, 's.status': 'enrolled'
        }).whereNull('s.archived_at')
        .select('s.id', 's.campus_id', 'e.section_id', 's.section_name',
          's.given_name_en', 's.father_name_en');
    }
    if (actor.role === 'parent_guardian') {
      return query('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .join('students as s', 's.id', 'sg.student_id')
        .join('campuses as c', 'c.id', 's.campus_id')
        .leftJoin('enrolments as e', function joinActiveEnrolment() {
          this.on('e.student_id', 's.id').andOnVal('e.status', '=', 'active');
        })
        .where({
          'g.organization_id': actor.orgId, 'g.user_id': actor.sub,
          'c.organization_id': actor.orgId, 's.campus_id': actor.activeCampusId,
          'sg.is_verified': true
        }).whereNull('s.archived_at')
        .select('s.id', 's.campus_id', 'e.section_id', 's.section_name',
          's.given_name_en', 's.father_name_en');
    }
    return [];
  },
  async addOfficeNotifications(trx, organizationId, campusId, sourceType, sourceId, title) {
    const recipients = await trx('user_campuses as uc')
      .join('users as u', 'u.id', 'uc.user_id')
      .where({
        'u.organization_id': organizationId, 'uc.campus_id': campusId,
        'uc.is_active': true, 'u.is_active': true
      }).whereIn('u.role', officeRoles).select('u.id');
    if (recipients.length) await trx('user_notifications').insert(recipients.map(({ id }) => ({
      id: randomUUID(), campus_id: campusId, user_id: id,
      source_type: sourceType, source_id: sourceId,
      title_en: title, title_am: title, body_en: title, body_am: title
    })));
  },
  async assertPortalStudentAccess(query, actor, studentId) {
    const student = await query('students as s').join('campuses as c', 'c.id', 's.campus_id')
      .where({
        's.id': studentId, 's.campus_id': actor.activeCampusId,
        's.status': 'enrolled', 'c.organization_id': actor.orgId
      }).whereNull('s.archived_at').first('s.id');
    if (!student) throw campusScopeError('The selected student is outside the active campus.');
    const section = await query('enrolments').where({
      student_id: studentId, status: 'active'
    }).orderBy('enrolled_on', 'desc').first('section_id');
    student.section_id = section?.section_id ?? null;
    if (actor.role === 'student' && !await query('students').where({
      id: studentId, user_id: actor.sub
    }).first('id')) throw campusScopeError('The selected student is not this account.');
    const campus = await query('campuses').where({
      id: actor.activeCampusId, organization_id: actor.orgId
    }).first('id');
    if (!campus) throw campusScopeError('Campus is outside the active organization.');
    if (actor.role === 'parent_guardian') {
      const link = await query('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': studentId, 'sg.is_verified': true,
          'g.user_id': actor.sub, 'g.organization_id': actor.orgId
        }).first('sg.student_id');
      if (!link) throw campusScopeError('The selected student is not linked to this parent.');
    }
    return student;
  },
  async getPortalCalendar(actor, range) {
    const students = await this.portalStudentRows(actor);
    const sectionIds = [...new Set(students.map((item) => item.section_id).filter(Boolean))];
    const announcementsQuery = this.db('campus_announcements').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).where('published_at', '<=', this.db.fn.now())
      .where((builder) => builder.where('audience', 'school')
        .orWhereIn('section_id', sectionIds.length ? sectionIds : ['__none__']));
    const eventsQuery = this.db('campus_events').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'published'
    }).where('starts_on', '<=', range.to).where('ends_on', '>=', range.from)
      .where((builder) => builder.where('audience', 'school')
        .orWhereIn('section_id', sectionIds.length ? sectionIds : ['__none__']));
    const [announcements, events, timetable] = await Promise.all([
      announcementsQuery.orderBy('published_at', 'desc').limit(100),
      eventsQuery.orderBy('starts_on').orderBy('starts_at').limit(200),
      sectionIds.length ? this.db('teaching_assignments as ta')
        .join('campuses as c', 'c.id', 'ta.campus_id')
        .join('sections as sec', 'sec.id', 'ta.section_id')
        .leftJoin('subjects as sub', 'sub.id', 'ta.subject_id')
        .leftJoin('staff as st', 'st.id', 'ta.staff_id')
        .where({
          'ta.campus_id': actor.activeCampusId, 'ta.is_active': true,
          'c.organization_id': actor.orgId
        }).whereIn('ta.section_id', sectionIds)
        .select('ta.id', 'ta.section_id', 'ta.subject_id', 'ta.day_of_week',
          'ta.period_number', 'ta.room_id', 'sub.name_en as subject_name',
          'sec.name as section_name', 'st.user_id as teacher_user_id',
          'st.given_name_en as teacher_name',
          'st.father_name_en as teacher_father_name')
        .orderBy('ta.day_of_week').orderBy('ta.period_number') : []
    ]);
    return {
      students: students.map((row) => ({
        id: row.id, name: `${row.given_name_en} ${row.father_name_en}`.trim(),
        sectionId: row.section_id, sectionName: row.section_name
      })),
      announcements: announcements.map((row) => ({
        id: row.id, titleEn: row.title_en, titleAm: row.title_am,
        bodyEn: row.body_en, bodyAm: row.body_am, publishedAt: row.published_at
      })),
      events: events.map((row) => ({
        id: row.id, type: row.event_type, titleEn: row.title_en, titleAm: row.title_am,
        descriptionEn: row.description_en, descriptionAm: row.description_am,
        startsOn: String(row.starts_on).slice(0, 10), endsOn: String(row.ends_on).slice(0, 10),
        startsAt: row.starts_at == null ? null : String(row.starts_at).slice(0, 5),
        endsAt: row.ends_at == null ? null : String(row.ends_at).slice(0, 5),
        location: row.location
      })),
      timetable: timetable.map((row) => ({
        id: row.id, sectionId: row.section_id, sectionName: row.section_name,
        subjectId: row.subject_id, subjectName: row.subject_name ?? '',
        teacherName: `${row.teacher_name ?? ''} ${row.teacher_father_name ?? ''}`.trim(),
        teacherUserId: row.teacher_user_id,
        dayOfWeek: row.day_of_week, periodNumber: row.period_number, roomId: row.room_id
      }))
    };
  },
  async createPortalRequest(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      await this.assertPortalStudentAccess(trx, actor, data.studentId);
      await trx('portal_requests').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        requester_id: actor.sub, student_id: data.studentId, type: data.type,
        subject: data.subject, details: data.details
      });
      await trx('audit_log').insert(auditRow(actor, 'portal.request_created',
        'portal_request', id, null, { studentId: data.studentId, type: data.type, subject: data.subject }));
      await this.addOfficeNotifications(
        trx, actor.orgId, actor.activeCampusId, 'portal_request', id, data.subject
      );
    });
    return mapRequest(await this.db('portal_requests').where({ id }).first());
  },
  async listPortalRequests(actor) {
    const query = this.db('portal_requests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (!officeRoles.includes(actor.role)) query.where({ requester_id: actor.sub });
    return (await query.orderBy('created_at', 'desc').limit(200)).map(mapRequest);
  },
  async updatePortalRequest(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('portal_requests').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const transitions = { pending: ['approved', 'rejected'], approved: ['completed'], rejected: [], completed: [] };
      if (!officeRoles.includes(actor.role)) throw campusScopeError('Only the school office can handle requests.');
      if (!transitions[row.status]?.includes(data.status)) {
        const error = new Error(`Cannot change a ${row.status} request to ${data.status}.`);
        error.status = 409; error.code = 'PORTAL_REQUEST_TRANSITION_INVALID'; throw error;
      }
      await trx('portal_requests').where({ id }).update({
        status: data.status, response: data.response, handled_by: actor.sub,
        status_changed_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'portal.request_status_changed',
        'portal_request', id, { status: row.status, response: row.response }, {
          status: data.status, response: data.response
        }));
      await trx('user_notifications').insert({
        id: randomUUID(), campus_id: actor.activeCampusId, user_id: row.requester_id,
        source_type: 'portal_request_status', source_id: id,
        title_en: 'Request status updated', title_am: 'የጥያቄ ሁኔታ ተዘምኗል',
        body_en: data.status, body_am: data.status
      });
      return mapRequest({ ...row, status: data.status, response: data.response, handled_by: actor.sub });
    });
  },
  async createPortalSupportRequest(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      const students = await this.portalStudentRows(actor, trx);
      const student = students.find((item) => !data.studentId || item.id === data.studentId);
      if (!student) throw campusScopeError('The selected student is not linked to this account.');
      await trx('support_requests').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        requester_id: actor.sub, student_id: student.id, category: data.category,
        subject: data.subject, details: data.details
      });
      await trx('audit_log').insert(auditRow(actor, 'portal.support_created',
        'support_request', id, null, { studentId: student.id, category: data.category, subject: data.subject }));
      await this.addOfficeNotifications(
        trx, actor.orgId, actor.activeCampusId, 'support_request', id, data.subject
      );
    });
    return mapRequest(await this.db('support_requests').where({ id }).first());
  },
  async listPortalSupportRequests(actor) {
    const query = this.db('support_requests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    });
    if (!officeRoles.includes(actor.role) && actor.role !== 'academic_head') {
      if (['homeroom_teacher', 'subject_teacher'].includes(actor.role)) {
        query.where((builder) => builder.where('requester_id', actor.sub).orWhereIn('student_id',
          this.db('teaching_assignments as ta').join('staff as st', 'st.id', 'ta.staff_id')
            .join('campuses as c', 'c.id', 'ta.campus_id')
            .join('enrolments as e', 'e.section_id', 'ta.section_id')
            .where({
              'ta.campus_id': actor.activeCampusId, 'ta.is_active': true, 'st.user_id': actor.sub,
              'e.status': 'active', 'c.organization_id': actor.orgId
            }).select('e.student_id')));
      } else query.where({ requester_id: actor.sub });
    }
    const rows = await query.orderBy('created_at', 'desc').limit(200);
    return rows.map(mapRequest);
  },
  async updatePortalSupportRequest(id, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('support_requests').where({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const transitions = { open: ['in_progress', 'resolved', 'closed'], in_progress: ['resolved', 'closed'], resolved: ['closed'], closed: [] };
      if (!staffRoles.includes(actor.role)) throw campusScopeError('Only school staff can handle support requests.');
      if (!transitions[row.status]?.includes(data.status)) {
        const error = new Error(`Cannot change a ${row.status} support request to ${data.status}.`);
        error.status = 409; error.code = 'PORTAL_SUPPORT_TRANSITION_INVALID'; throw error;
      }
      await trx('support_requests').where({ id }).update({
        status: data.status, response: data.response, assigned_to: actor.sub,
        status_changed_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'portal.support_status_changed',
        'support_request', id, { status: row.status, response: row.response }, {
          status: data.status, response: data.response
        }));
      return mapRequest({ ...row, status: data.status, response: data.response, assigned_to: actor.sub });
    });
  },
  async isPortalMessagingEnabled(organizationId) {
    const row = await this.db('organizations').where({ id: organizationId }).first('messaging_enabled');
    return !row || Boolean(row.messaging_enabled);
  },
  async setPortalMessagingEnabled(enabled, actor) {
    const row = await this.db('organizations').where({ id: actor.orgId }).first('messaging_enabled');
    if (!row) return null;
    await this.db.transaction(async (trx) => {
      await trx('organizations').where({ id: actor.orgId }).update({ messaging_enabled: enabled });
      await trx('audit_log').insert(auditRow(actor, 'portal.messaging_setting_changed',
        'organization', actor.orgId, { messagingEnabled: Boolean(row.messaging_enabled) },
        { messagingEnabled: enabled }));
    });
    return { messagingEnabled: enabled };
  },
  async listPortalMessageThreads(actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const moderator = ['owner_director', 'principal', 'system_admin'].includes(actor.role);
    const query = this.db('message_threads as mt').where({
      'mt.organization_id': actor.orgId, 'mt.campus_id': actor.activeCampusId
    });
    if (!moderator) query.join('thread_participants as tp', 'tp.thread_id', 'mt.id')
      .where('tp.user_id', actor.sub);
    const rows = await query.distinct('mt.*').orderBy('mt.created_at', 'desc').limit(100);
    return Promise.all(rows.map(async (row) => {
      const [participants, messages] = await Promise.all([
        this.db('thread_participants as tp').join('users as u', 'u.id', 'tp.user_id')
          .where({
            'tp.thread_id': row.id, 'tp.organization_id': actor.orgId,
            'tp.campus_id': actor.activeCampusId
          })
          .select('tp.user_id', 'tp.role', 'tp.read_at', 'u.name'),
        this.db('messages').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          thread_id: row.id, status: 'visible'
        }).orderBy('sent_at').limit(200)
      ]);
      const own = participants.find((item) => item.user_id === actor.sub);
      return {
        id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        studentId: row.student_id, status: row.status, createdAt: row.created_at,
        participants: participants.map((item) => ({
          userId: item.user_id, role: item.role, name: item.name
        })),
        unreadCount: own?.read_at ? 0 : messages.filter((item) => item.sender_id !== actor.sub).length,
        messages: messages.map((item) => ({
          id: item.id, threadId: item.thread_id, senderId: item.sender_id,
          body: item.body, status: item.status,
          sentAt: item.sent_at instanceof Date ? item.sent_at.toISOString() : item.sent_at
        }))
      };
    }));
  },
  async createPortalMessageThread(data, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const student = await this.db('students').where({
      id: data.studentId, campus_id: actor.activeCampusId,
      status: 'enrolled'
    }).whereNull('archived_at').first('id');
    if (!student || !await this.db('campuses').where({
      id: actor.activeCampusId, organization_id: actor.orgId
    }).first('id')) throw campusScopeError('Student is outside the active campus.');
    student.section_id = (await this.db('enrolments').where({
      student_id: student.id, status: 'active'
    }).orderBy('enrolled_on', 'desc').first('section_id'))?.section_id ?? null;
    let parentId; let teacherId;
    if (actor.role === 'parent_guardian') {
      const parentLink = await this.db('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': student.id, 'sg.is_verified': true,
          'g.user_id': actor.sub, 'g.organization_id': actor.orgId
        }).first('g.user_id');
      if (!parentLink || !data.recipientId) throw campusScopeError('The student is not linked to this parent.');
      const assigned = await this.db('teaching_assignments as ta')
        .join('staff as st', 'st.id', 'ta.staff_id')
        .where({
          'ta.campus_id': actor.activeCampusId, 'ta.section_id': student.section_id,
          'ta.is_active': true, 'st.user_id': data.recipientId
        }).whereNull('st.archived_at').first('ta.id');
      if (!assigned) throw campusScopeError('Teacher is not assigned to this student.');
      parentId = actor.sub; teacherId = data.recipientId;
    } else {
      const assigned = await this.db('teaching_assignments as ta')
        .join('staff as st', 'st.id', 'ta.staff_id')
        .where({
          'ta.campus_id': actor.activeCampusId, 'ta.section_id': student.section_id,
          'ta.is_active': true, 'st.user_id': actor.sub
        }).whereNull('st.archived_at').first('ta.id');
      const link = await this.db('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': student.id, 'sg.is_verified': true,
          'g.user_id': data.recipientId, 'g.organization_id': actor.orgId
        }).first('g.user_id');
      if (!assigned || !link) throw campusScopeError('The teacher is not assigned to this student or the parent is not linked.');
      parentId = data.recipientId; teacherId = actor.sub;
    }
    const key = threadKey(student.id, parentId, teacherId);
    let thread = await this.db('message_threads').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, thread_key: key
    }).first();
    if (!thread) {
      const id = randomUUID();
      try {
        await this.db.transaction(async (trx) => {
          await trx('message_threads').insert({
            id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            student_id: student.id, thread_key: key
          });
          await trx('thread_participants').insert([
            { organization_id: actor.orgId, campus_id: actor.activeCampusId,
              thread_id: id, user_id: parentId, role: 'parent_guardian' },
            { organization_id: actor.orgId, campus_id: actor.activeCampusId,
              thread_id: id, user_id: teacherId, role: 'teacher' }
          ]);
          await trx('audit_log').insert(auditRow(actor, 'portal.message_thread_created',
            'message_thread', id, null, { studentId: student.id }));
        });
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
      thread = await this.db('message_threads').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, thread_key: key
      }).first();
    }
    return this.sendPortalMessage(thread.id, data.body, actor);
  },
  async sendPortalMessage(threadId, body, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const thread = await trx('message_threads').where({
        id: threadId, organization_id: actor.orgId, campus_id: actor.activeCampusId, status: 'open'
      }).forUpdate().first();
      const participant = await trx('thread_participants').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        thread_id: threadId, user_id: actor.sub
      }).first('user_id');
      if (!thread || !participant) throw campusScopeError('Message thread is not available to this account.');
      await trx('messages').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        thread_id: threadId, sender_id: actor.sub, body
      });
      await trx('thread_participants').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, thread_id: threadId
      })
        .whereNot({ user_id: actor.sub }).update({ read_at: null });
      await trx('audit_log').insert(auditRow(actor, 'portal.message_sent',
        'message', id, null, { threadId, bodyLength: body.length }));
      const recipients = await trx('thread_participants').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, thread_id: threadId
      })
        .whereNot({ user_id: actor.sub }).select('user_id');
      for (const recipient of recipients) {
        await trx('user_notifications').insert({
          id: randomUUID(), campus_id: actor.activeCampusId, user_id: recipient.user_id,
          source_type: 'portal_message', source_id: id,
          title_en: 'New parent-teacher message', title_am: 'አዲስ የወላጅ-መምህር መልዕክት',
          body_en: body.slice(0, 120), body_am: body.slice(0, 120)
        });
      }
      const row = await trx('messages').where({ id }).first();
      return {
        id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        threadId: row.thread_id, senderId: row.sender_id, body: row.body,
        status: row.status, sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at
      };
    });
  },
  async markPortalThreadRead(threadId, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    const updated = await this.db('thread_participants as tp')
      .join('message_threads as mt', 'mt.id', 'tp.thread_id')
      .where({
        'tp.thread_id': threadId, 'tp.user_id': actor.sub,
        'mt.organization_id': actor.orgId, 'mt.campus_id': actor.activeCampusId
      }).update({ 'tp.read_at': this.db.fn.now() });
    if (!updated) return null;
    const row = await this.db('thread_participants').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId,
      thread_id: threadId, user_id: actor.sub
    }).first('read_at');
    return { threadId, readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at };
  },
  async moderatePortalMessage(messageId, data, actor) {
    if (!await this.isPortalMessagingEnabled(actor.orgId)) {
      const error = new Error('Parent-teacher messaging is disabled by the school.');
      error.status = 403; error.code = 'PORTAL_MESSAGING_DISABLED'; throw error;
    }
    return this.db.transaction(async (trx) => {
      const row = await trx('messages').where({
        id: messageId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      await trx('messages').where({ id: messageId }).update({
        status: data.status, moderated_by: actor.sub, moderated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, 'portal.message_moderated',
        'message', messageId, { status: row.status }, { status: data.status, reason: data.reason }));
      return {
        id: row.id, threadId: row.thread_id, senderId: row.sender_id,
        body: row.body, status: data.status,
        sentAt: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at
      };
    });
  }
};
