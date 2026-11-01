import { randomUUID } from 'node:crypto';
import { weekdayNumber } from '../timetable.mappers.js';
import { auditRow, campusScopeError, scheduleConflict, setupConflict } from '../shared.js';
import { formatStaffName, mapStaff } from '../staff.mappers.js';

export const mysqlTimetableBundle = {
  async listTimetablePeriods(campusId) {
    return (await this.db('timetable_periods').where({ campus_id: campusId })
      .orderBy('shift').orderBy('period_number')).map((row) => ({
      id: row.id, campusId: row.campus_id, shift: row.shift,
      periodNumber: row.period_number, startsAt: String(row.starts_at).slice(0, 5),
      endsAt: String(row.ends_at).slice(0, 5)
    }));
  },
  async createTimetablePeriod(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        const overlap = await trx('timetable_periods').where({
          campus_id: actor.activeCampusId, shift: data.shift
        }).where('starts_at', '<', `${data.endsAt}:00`)
          .where('ends_at', '>', `${data.startsAt}:00`).first('id');
        if (overlap) throw scheduleConflict('Timetable periods in the same shift cannot overlap.');
        await trx('timetable_periods').insert({
          id, campus_id: actor.activeCampusId, shift: data.shift,
          period_number: data.periodNumber, starts_at: `${data.startsAt}:00`,
          ends_at: `${data.endsAt}:00`
        });
        await trx('audit_log').insert(auditRow(actor, 'timetable.period_created', 'timetable_period', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('This period number already exists for the selected shift.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data };
  },
  async listRooms(campusId) {
    return (await this.db('rooms').where({ campus_id: campusId, is_active: true }).orderBy('name'))
      .map((row) => ({
        id: row.id, campusId: row.campus_id, name: row.name,
        capacity: row.capacity == null ? null : Number(row.capacity), isActive: Boolean(row.is_active)
      }));
  },
  async createRoom(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('rooms').insert({
          id, campus_id: actor.activeCampusId, name: data.name, capacity: data.capacity ?? null
        });
        await trx('audit_log').insert(auditRow(actor, 'timetable.room_created', 'room', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A room with this name already exists at this campus.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data, capacity: data.capacity ?? null, isActive: true };
  },
  async listTimetable(actor, { sectionId, date } = {}) {
    let rows = await this.listTeachingAssignments(actor);
    if (date) {
      const weekday = weekdayNumber(date);
      rows = rows.filter((item) => item.dayOfWeek === weekday);
      const substitutions = await this.db('timetable_substitutions as ts')
        .join('teaching_assignments as ta', 'ta.id', 'ts.teaching_assignment_id')
        .join('staff as substitute', 'substitute.id', 'ts.substitute_staff_id')
        .where({ 'ts.campus_id': actor.activeCampusId, 'ts.substitution_date': date })
        .select(
          'ts.teaching_assignment_id', 'ts.substitute_staff_id', 'ts.substitution_date',
          'ta.section_id', 'ta.subject_id', 'ta.room_id', 'ta.day_of_week', 'ta.period_number',
          'substitute.given_name_en', 'substitute.father_name_en', 'substitute.grandfather_name_en',
          'substitute.given_name_am', 'substitute.father_name_am', 'substitute.grandfather_name_am'
        );
      const actorStaff = await this.db('staff').where({
        campus_id: actor.activeCampusId, user_id: actor.sub
      }).whereNull('archived_at').first('id');
      const canSeeCampus = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(actor.role);
      for (const substitution of substitutions) {
        const originalVisible = rows.some((item) => item.id === substitution.teaching_assignment_id);
        const isSubstitute = actorStaff?.id === substitution.substitute_staff_id;
        if (!canSeeCampus && !originalVisible && !isSubstitute) continue;
        rows = rows.filter((item) => item.id !== substitution.teaching_assignment_id);
        if (canSeeCampus || isSubstitute) {
          rows.push({
            id: substitution.teaching_assignment_id, campusId: actor.activeCampusId,
            staffId: substitution.substitute_staff_id, effectiveStaffId: substitution.substitute_staff_id,
            effectiveStaffName: formatStaffName(mapStaff(substitution)),
            sectionId: substitution.section_id, subjectId: substitution.subject_id,
            roomId: substitution.room_id, dayOfWeek: substitution.day_of_week,
            periodNumber: substitution.period_number, isActive: true,
            isSubstitute: true, substitutionDate: date
          });
        }
      }
    }
    return rows.filter((item) => !sectionId || item.sectionId === sectionId)
      .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || (a.periodNumber ?? 0) - (b.periodNumber ?? 0));
  },
  async createTimetableSubstitution(assignmentId, data, actor) {
    return this.db.transaction(async (trx) => {
      const assignment = await trx('teaching_assignments as ta')
        .join('staff as original', 'original.id', 'ta.staff_id')
        .where({
          'ta.id': assignmentId, 'ta.campus_id': actor.activeCampusId, 'ta.is_active': true
        }).whereNotNull('ta.day_of_week').forUpdate().first('ta.*', 'original.employment_status');
      if (!assignment) return null;
      if (assignment.day_of_week !== weekdayNumber(data.date)) {
        throw setupConflict('The substitution date does not match this timetable day.');
      }
      const leave = await trx('leave_requests').where({
        id: data.leaveRequestId, campus_id: actor.activeCampusId, staff_id: assignment.staff_id,
        status: 'approved'
      }).where('start_date', '<=', data.date).where('end_date', '>=', data.date).first('id');
      if (!leave) throw setupConflict('An approved leave request for the assigned teacher is required.');
      const substitute = await trx('staff').where({
        id: data.substituteStaffId, campus_id: actor.activeCampusId,
        employment_status: 'active'
      }).whereNull('archived_at').first();
      if (!substitute || substitute.id === assignment.staff_id) {
        throw campusScopeError('Choose a different active staff member at this campus.');
      }
      const regularConflict = await trx('teaching_assignments').where({
        campus_id: actor.activeCampusId, staff_id: substitute.id,
        day_of_week: assignment.day_of_week, period_number: assignment.period_number, is_active: true
      }).first('id');
      const substituteConflict = await trx('timetable_substitutions as ts')
        .join('teaching_assignments as other', 'other.id', 'ts.teaching_assignment_id')
        .where({
          'ts.campus_id': actor.activeCampusId, 'ts.substitute_staff_id': substitute.id,
          'ts.substitution_date': data.date, 'other.period_number': assignment.period_number
        }).first('ts.id');
      if (regularConflict || substituteConflict) {
        throw scheduleConflict('The substitute already has a class at this time.');
      }
      const id = randomUUID();
      try {
        await trx('timetable_substitutions').insert({
          id, campus_id: actor.activeCampusId, teaching_assignment_id: assignmentId,
          substitute_staff_id: substitute.id, substitution_date: data.date,
          leave_request_id: leave.id, reason: data.reason, created_by: actor.sub
        });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw setupConflict('A substitute has already been assigned for this timetable slot and date.');
        throw error;
      }
      await trx('audit_log').insert(auditRow(actor, 'timetable.substitute_assigned',
        'timetable_assignment', assignmentId, null,
        { substituteStaffId: substitute.id, date: data.date, leaveRequestId: leave.id }));
      return {
        id, campusId: actor.activeCampusId, assignmentId,
        substituteStaffId: substitute.id, substituteName: formatStaffName(mapStaff(substitute)),
        date: data.date, leaveRequestId: leave.id, reason: data.reason
      };
    });
  }
};
