import { randomUUID } from 'node:crypto';
import { weekdayNumber } from '../timetable.mappers.js';
import { campusScopeError, scheduleConflict, setupConflict } from '../shared.js';
import { formatStaffName } from '../staff.mappers.js';

export const memoryTimetableBundle = {
  async listTimetable(actor, { sectionId, date } = {}) {
    const weekday = date ? weekdayNumber(date) : null;
    const visible = await this.listTeachingAssignments(actor);
    const byId = new Map(visible.map((item) => [item.id, item]));
    let rows = [...visible];
    let substitutions = this.timetableSubstitutions.filter((item) =>
      date && item.campusId === actor.activeCampusId && item.date === date);
    if (date) substitutions = substitutions.filter((item) => item.dayOfWeek === weekday);
    const actorStaff = this.staff.find((item) =>
      item.userId === actor.sub && item.campusId === actor.activeCampusId);
    for (const substitution of substitutions) {
      const assignment = this.teachingAssignments.find((item) => item.id === substitution.assignmentId);
      if (!assignment) continue;
      const manager = ['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(actor.role);
      const isOriginal = actorStaff?.id === assignment.staffId;
      const isSubstitute = actorStaff?.id === substitution.substituteStaffId;
      if (!manager && !isOriginal && !isSubstitute) continue;
      if (isOriginal) byId.delete(assignment.id);
      if (manager || isSubstitute) {
        const mapped = this.mapAssignment(assignment);
        rows = rows.filter((item) => item.id !== assignment.id);
        rows.push({
          ...mapped, effectiveStaffId: substitution.substituteStaffId,
          effectiveStaffName: formatStaffName(this.staff.find((item) => item.id === substitution.substituteStaffId)),
          isSubstitute: true, substitutionDate: substitution.date
        });
      }
    }
    return rows.filter((item) => byId.has(item.id) || item.isSubstitute)
      .filter((item) => !sectionId || item.sectionId === sectionId)
      .filter((item) => weekday == null || item.dayOfWeek === weekday)
      .sort((a, b) => (a.dayOfWeek ?? 0) - (b.dayOfWeek ?? 0) || (a.periodNumber ?? 0) - (b.periodNumber ?? 0));
  },
  async createTimetableSubstitution(assignmentId, data, actor) {
    const assignment = this.teachingAssignments.find((item) =>
      item.id === assignmentId && item.campusId === actor.activeCampusId && item.isActive && item.dayOfWeek != null);
    if (!assignment) return null;
    if (assignment.dayOfWeek !== weekdayNumber(data.date)) {
      throw setupConflict('The substitution date does not match this timetable day.');
    }
    const leave = this.leaveRequests.find((item) =>
      item.id === data.leaveRequestId && item.campusId === actor.activeCampusId &&
      item.staffId === assignment.staffId && item.status === 'approved' &&
      item.startDate <= data.date && item.endDate >= data.date);
    if (!leave) throw setupConflict('An approved leave request for the assigned teacher is required.');
    const substitute = this.staff.find((item) =>
      item.id === data.substituteStaffId && item.campusId === actor.activeCampusId &&
      !item.archivedAt && item.employmentStatus === 'active');
    if (!substitute || substitute.id === assignment.staffId) {
      throw campusScopeError('Choose a different active staff member at this campus.');
    }
    const conflict = this.teachingAssignments.some((slot) =>
      slot.isActive && slot.staffId === substitute.id && slot.dayOfWeek === assignment.dayOfWeek &&
      slot.periodNumber === assignment.periodNumber && slot.id !== assignment.id);
    const substitutionConflict = this.timetableSubstitutions.some((item) =>
      item.campusId === actor.activeCampusId && item.date === data.date &&
      item.substituteStaffId === substitute.id &&
      this.teachingAssignments.some((slot) => slot.id === item.assignmentId &&
        slot.periodNumber === assignment.periodNumber));
    if (conflict || substitutionConflict) throw scheduleConflict('The substitute already has a class at this time.');
    if (this.timetableSubstitutions.some((item) =>
      item.assignmentId === assignmentId && item.date === data.date)) {
      throw setupConflict('A substitute has already been assigned for this timetable slot and date.');
    }
    const substitution = {
      id: randomUUID(), campusId: actor.activeCampusId, assignmentId,
      substituteStaffId: substitute.id, date: data.date, dayOfWeek: assignment.dayOfWeek,
      leaveRequestId: leave.id, reason: data.reason
    };
    this.timetableSubstitutions.push(substitution);
    await this.appendAudit(actor, 'timetable.substitute_assigned', 'timetable_assignment', assignmentId,
      null, { substituteStaffId: substitute.id, date: data.date, leaveRequestId: leave.id });
    return { ...substitution, substituteName: formatStaffName(substitute) };
  },
  async listTimetablePeriods(campusId) {
    return this.timetablePeriods.filter((item) => item.campusId === campusId)
      .sort((a, b) => a.shift.localeCompare(b.shift) || a.periodNumber - b.periodNumber);
  },
  async createTimetablePeriod(data, actor) {
    if (this.timetablePeriods.some((item) => item.campusId === actor.activeCampusId &&
        item.shift === data.shift && item.periodNumber === data.periodNumber)) {
      throw setupConflict('This period number already exists for the selected shift.');
    }
    if (this.timetablePeriods.some((item) => item.campusId === actor.activeCampusId &&
        item.shift === data.shift && data.startsAt < item.endsAt && data.endsAt > item.startsAt)) {
      throw scheduleConflict('Timetable periods in the same shift cannot overlap.');
    }
    const period = { id: randomUUID(), campusId: actor.activeCampusId, ...data };
    this.timetablePeriods.push(period);
    await this.appendAudit(actor, 'timetable.period_created', 'timetable_period', period.id, null, data);
    return period;
  },
  async listRooms(campusId) {
    return this.rooms.filter((item) => item.campusId === campusId && item.isActive);
  },
  async createRoom(data, actor) {
    if (this.rooms.some((item) => item.campusId === actor.activeCampusId &&
        item.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('A room with this name already exists at this campus.');
    }
    const room = { id: randomUUID(), campusId: actor.activeCampusId, ...data, isActive: true };
    this.rooms.push(room);
    await this.appendAudit(actor, 'timetable.room_created', 'room', room.id, null, data);
    return room;
  }
};
