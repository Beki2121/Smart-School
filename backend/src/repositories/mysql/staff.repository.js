import { randomUUID } from 'node:crypto';
import { auditRow, campusScopeError, planLimitError, scheduleConflict, setupConflict } from '../shared.js';
import { formatStaffName, mapLeaveRequest, mapStaff, mapStaffAttendance } from '../staff.mappers.js';

export const mysqlStaffBundle = {
  async assertStaffCapacity(organizationId, additional = 1, query = this.db) {
    const subscription = await query('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .forUpdate().select('sp.staff_limit').first();
    if (!subscription || subscription.staff_limit == null) return;
    const result = await query('staff as s')
      .join('campuses as c', 'c.id', 's.campus_id')
      .where('c.organization_id', organizationId).whereNull('s.archived_at')
      .whereNot('s.employment_status', 'terminated')
      .count({ total: 's.id' }).first();
    if (Number(result.total) + additional > Number(subscription.staff_limit)) {
      throw planLimitError('staff', Number(subscription.staff_limit));
    }
  },
  async listDepartments(campusId) {
    const rows = await this.db('departments').where({ campus_id: campusId }).orderBy('name');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, name: row.name, description: row.description ?? ''
    }));
  },
  async createDepartment(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('departments').insert({
          id, campus_id: actor.activeCampusId, name: data.name, description: data.description
        });
        await trx('audit_log').insert(auditRow(actor, 'department.created', 'department', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Department name already exists at this campus.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data };
  },
  async listStaff(actor) {
    const visibility = ['principal', 'registrar'].includes(actor.role)
      ? {} : await this.staffVisibility(actor);
    if (visibility.empty) return [];
    const query = this.db('staff as s')
      .leftJoin('departments as d', 'd.id', 's.department_id')
      .where({ 's.campus_id': actor.activeCampusId })
      .whereNull('s.archived_at');
    if (visibility.staffId) query.where('s.id', visibility.staffId);
    if (visibility.departmentId) query.where('s.department_id', visibility.departmentId);
    const rows = await query.select(
      's.*', 'd.name as department_name',
      this.db.raw('(select count(*) from teaching_assignments ta where ta.staff_id = s.id and ta.is_active = 1) as teaching_count'),
      this.db.raw('(select count(*) from homeroom_assignments ha where ha.staff_id = s.id) as homeroom_count')
    ).orderBy('s.given_name_en').orderBy('s.father_name_en');
    return rows.map((row) => mapStaff(row, {
      departmentName: row.department_name ?? '',
      teachingAssignmentCount: Number(row.teaching_count),
      homeroomCount: Number(row.homeroom_count)
    }));
  },
  async staffVisibility(actor) {
    if (['owner_director', 'group_executive', 'hr_admin', 'system_admin'].includes(actor.role)) return {};
    const own = await this.db('staff').where({
      campus_id: actor.activeCampusId, user_id: actor.sub
    }).whereNull('archived_at').first();
    if (!own) return { empty: true };
    if (['principal', 'academic_head'].includes(actor.role)) {
      return own.department_id ? { departmentId: own.department_id } : { staffId: own.id };
    }
    return { staffId: own.id };
  },
  async createStaff(data, actor) {
    if (data.departmentId && !await this.db('departments').where({
      id: data.departmentId, campus_id: actor.activeCampusId
    }).first()) {
      throw campusScopeError('Department is outside the active campus.');
    }
    if (data.userId) {
      const user = await this.db('users as u')
        .join('user_campuses as uc', 'uc.user_id', 'u.id')
        .where({
          'u.id': data.userId, 'u.organization_id': actor.orgId,
          'uc.campus_id': actor.activeCampusId, 'uc.is_active': true
        }).first('u.id');
      if (!user) throw campusScopeError('Linked account is outside the active campus organization.');
    }
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, user_id: data.userId ?? null,
      department_id: data.departmentId ?? null,
      given_name_en: data.givenNameEn, father_name_en: data.fatherNameEn,
      grandfather_name_en: data.grandfatherNameEn, given_name_am: data.givenNameAm,
      father_name_am: data.fatherNameAm, grandfather_name_am: data.grandfatherNameAm,
      job_title: data.jobTitle, qualification: data.qualification ?? '',
      employment_status: data.employmentStatus, hired_on: data.hiredOn ?? null
    };
    try {
      await this.db.transaction(async (trx) => {
        await this.assertStaffCapacity(actor.orgId, 1, trx);
        await trx('staff').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'staff.created', 'staff', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Account is already linked to a staff profile.');
      throw error;
    }
    const department = data.departmentId ? await this.db('departments').where({ id: data.departmentId }).first() : null;
    return mapStaff(row, { departmentName: department?.name ?? '', teachingAssignmentCount: 0, homeroomCount: 0 });
  },
  async createTeachingAssignment(data, actor) {
    const id = randomUUID();
    try {
      return await this.db.transaction(async (trx) => {
        const staff = await trx('staff').where({
          id: data.staffId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').forUpdate().first();
        const section = await trx('sections as s')
          .join('academic_years as y', 'y.id', 's.academic_year_id')
          .where({
            's.id': data.sectionId, 's.campus_id': actor.activeCampusId, 'y.status': 'active'
          }).first('s.id', 's.name', 's.shift', 's.stream', 's.grade_level_id');
        const subject = await trx('subjects').where({
          id: data.subjectId, campus_id: actor.activeCampusId
        }).first('id', 'name_en');
        if (!staff || !section || !subject) throw campusScopeError('Staff, section or subject is outside the active campus.');
        const gradeSubject = await trx('grade_subjects').where({
          grade_level_id: section.grade_level_id, subject_id: subject.id
        }).whereIn('stream', ['all', section.stream ?? 'all']).first('id');
        if (!gradeSubject) throw setupConflict('This subject is not included in the selected grade and stream.');
        const room = data.roomId
          ? await trx('rooms').where({
            id: data.roomId, campus_id: actor.activeCampusId, is_active: true
          }).first('id', 'name')
          : null;
        if (data.roomId && !room) throw campusScopeError('Room is outside the active campus.');
        if (data.dayOfWeek != null) {
          const period = await trx('timetable_periods').where({
            campus_id: actor.activeCampusId, shift: section.shift ?? 'morning',
            period_number: data.periodNumber
          }).first('id');
          if (!period) throw setupConflict('Configure this period for the section shift before assigning a timetable slot.');
          const conflict = await trx('teaching_assignments')
            .where({ campus_id: actor.activeCampusId, day_of_week: data.dayOfWeek, period_number: data.periodNumber, is_active: true })
            .andWhere((builder) => {
              builder.where('staff_id', staff.id).orWhere('section_id', section.id);
              if (room) builder.orWhere('room_id', room.id);
            })
            .first();
          if (conflict) throw scheduleConflict('Teacher, section or room already has an assignment in this timetable period.');
        }
        const row = {
          id, campus_id: actor.activeCampusId, staff_id: staff.id, section_id: section.id,
          subject_id: subject.id, day_of_week: data.dayOfWeek ?? null,
          period_number: data.periodNumber ?? null, room_id: room?.id ?? null, is_active: true
        };
        await trx('teaching_assignments').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'teaching_assignment.created', 'teaching_assignment', id, null, data));
        return {
          id, campusId: actor.activeCampusId, staffId: staff.id, sectionId: section.id,
          subjectId: data.subjectId, roomId: row.room_id, roomName: room?.name ?? '',
          shift: section.shift ?? 'morning', dayOfWeek: row.day_of_week, periodNumber: row.period_number,
          isActive: true, staffName: formatStaffName(mapStaff(staff)),
          sectionName: section.name, subjectName: subject.name_en
        };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        if (data.dayOfWeek != null) throw scheduleConflict('Teacher, section or room already has an assignment in this timetable period.');
        throw setupConflict('This teacher is already assigned to this section and subject.');
      }
      throw error;
    }
  },
  async listTeachingAssignments(actor) {
    const visibility = await this.staffVisibility(actor);
    if (visibility.empty) return [];
    const query = this.db('teaching_assignments as ta')
      .join('staff as st', 'st.id', 'ta.staff_id')
      .join('sections as sc', 'sc.id', 'ta.section_id')
      .join('subjects as su', 'su.id', 'ta.subject_id')
      .leftJoin('rooms as r', 'r.id', 'ta.room_id')
      .where({ 'ta.campus_id': actor.activeCampusId, 'ta.is_active': true })
      .whereNull('st.archived_at');
    if (visibility.staffId) query.where('st.id', visibility.staffId);
    if (visibility.departmentId) query.where('st.department_id', visibility.departmentId);
    const rows = await query.select('ta.*', 'sc.name as section_name', 'sc.shift as section_shift',
      'su.name_en as subject_name', 'r.name as room_name',
      'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en',
      'st.given_name_am', 'st.father_name_am', 'st.grandfather_name_am');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, staffId: row.staff_id,
      sectionId: row.section_id, subjectId: row.subject_id, dayOfWeek: row.day_of_week,
      roomId: row.room_id ?? null, roomName: row.room_name ?? '', shift: row.section_shift ?? 'morning',
      periodNumber: row.period_number, isActive: Boolean(row.is_active),
      staffName: formatStaffName(mapStaff(row)), sectionName: row.section_name, subjectName: row.subject_name
    }));
  },
  async assignHomeroom(sectionId, staffId, actor) {
    return this.db.transaction(async (trx) => {
      const section = await trx('sections as s')
        .join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({ 's.id': sectionId, 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
        .first('s.name');
      const staff = await trx('staff').where({
        id: staffId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first();
      if (!section || !staff) throw campusScopeError('Staff or section is outside the active campus.');
      const previous = await trx('homeroom_assignments').where({ section_id: sectionId }).forUpdate().first();
      const assignment = { campus_id: actor.activeCampusId, section_id: sectionId, staff_id: staffId };
      if (previous) await trx('homeroom_assignments').where({ section_id: sectionId }).update(assignment);
      else await trx('homeroom_assignments').insert(assignment);
      await trx('audit_log').insert(auditRow(
        actor, 'homeroom.assigned', 'section', sectionId,
        previous ? { staffId: previous.staff_id } : null, { staffId, sectionName: section.name }
      ));
      return { sectionId, staffId, staffName: formatStaffName(mapStaff(staff)), sectionName: section.name };
    });
  },
  async resolveStaff(staffId, actor, trx = this.db) {
    const targetId = staffId ?? (await trx('staff').where({
      user_id: actor.sub, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first())?.id;
    const staff = await trx('staff').where({
      id: targetId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first();
    if (!staff) throw campusScopeError('Staff profile is not available at this campus.');
    const canManage = ['owner_director', 'principal', 'hr_admin', 'system_admin'].includes(actor.role);
    if (!canManage && staff.user_id !== actor.sub) throw campusScopeError('Staff may only access their own records.');
    return staff;
  },
  async recordStaffAttendance(data, actor) {
    return this.db.transaction(async (trx) => {
      const staff = await this.resolveStaff(data.staffId, actor, trx);
      const prior = await trx('staff_attendance').where({
        campus_id: actor.activeCampusId, staff_id: staff.id, attendance_date: data.date
      }).forUpdate().first();
      const id = prior?.id ?? randomUUID();
      const after = {
        id, campus_id: actor.activeCampusId, staff_id: staff.id, attendance_date: data.date,
        status: data.status, clock_in: data.clockIn ?? null, clock_out: data.clockOut ?? null,
        recorded_by: actor.sub
      };
      if (prior) await trx('staff_attendance').where({ id }).update(after);
      else await trx('staff_attendance').insert(after);
      await trx('audit_log').insert(auditRow(actor,
        prior ? 'staff_attendance.updated' : 'staff_attendance.recorded',
        'staff_attendance', id, prior ? mapStaffAttendance(prior) : null, data));
      return { ...mapStaffAttendance(after), duplicate: Boolean(prior) };
    });
  },
  async listStaffAttendance(actor) {
    const visibility = await this.staffVisibility(actor);
    if (visibility.empty) return [];
    const query = this.db('staff_attendance as sa')
      .join('staff as st', 'st.id', 'sa.staff_id')
      .leftJoin('departments as d', 'd.id', 'st.department_id')
      .where({ 'sa.campus_id': actor.activeCampusId })
      .whereNull('st.archived_at');
    if (visibility.staffId) query.where('st.id', visibility.staffId);
    if (visibility.departmentId) query.where('st.department_id', visibility.departmentId);
    const rows = await query.select('sa.*', 'd.name as department_name',
      'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en');
    return rows.map((row) => ({
      ...mapStaffAttendance(row), name: formatStaffName(mapStaff(row)), department: row.department_name ?? ''
    }));
  },
  async createLeaveRequest(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      const staff = await this.resolveStaff(data.staffId, actor, trx);
      const row = {
        id, campus_id: actor.activeCampusId, staff_id: staff.id,
        start_date: data.startDate, end_date: data.endDate, reason: data.reason, status: 'pending'
      };
      await trx('leave_requests').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'leave.requested', 'leave_request', id, null, data));
    });
    return (await this.findLeaveRequest(id, actor.activeCampusId));
  },
  async findLeaveRequest(id, campusId, trx = this.db) {
    const row = await trx('leave_requests as lr').join('staff as st', 'st.id', 'lr.staff_id')
      .where({ 'lr.id': id, 'lr.campus_id': campusId })
      .first('lr.*', 'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en');
    return row ? mapLeaveRequest(row) : null;
  },
  async listLeaveRequests(actor) {
    const visibility = await this.staffVisibility(actor);
    if (visibility.empty) return [];
    const query = this.db('leave_requests as lr').join('staff as st', 'st.id', 'lr.staff_id')
      .where({ 'lr.campus_id': actor.activeCampusId });
    if (visibility.staffId) query.where('st.id', visibility.staffId);
    if (visibility.departmentId) query.where('st.department_id', visibility.departmentId);
    const rows = await query.select('lr.*', 'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en')
      .orderBy('lr.created_at', 'desc').limit(500);
    return rows.map(mapLeaveRequest);
  },
  async reviewLeaveRequest(leaveId, data, actor) {
    return this.db.transaction(async (trx) => {
      const row = await trx('leave_requests').where({
        id: leaveId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (row.status !== 'pending') throw setupConflict('Only pending leave requests can be reviewed.');
      const before = { status: row.status };
      await trx('leave_requests').where({ id: leaveId }).update({
        status: data.decision, reviewed_by: actor.sub, review_note: data.note, reviewed_at: trx.fn.now()
      });
      const updated = await this.findLeaveRequest(leaveId, actor.activeCampusId, trx);
      await trx('audit_log').insert(auditRow(actor, `leave.${data.decision}`, 'leave_request', leaveId, before, updated));
      return updated;
    });
  }
};
