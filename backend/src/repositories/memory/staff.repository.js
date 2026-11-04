import { randomUUID } from 'node:crypto';
import { campusScopeError, now, planLimitError, scheduleConflict, setupConflict } from '../shared.js';
import { formatStaffName } from '../staff.mappers.js';

function leaveHalfDays(data) {
  if (data.requestedHalfDays != null) return data.requestedHalfDays;
  return Math.floor((Date.parse(`${data.endDate}T00:00:00Z`) -
    Date.parse(`${data.startDate}T00:00:00Z`)) / 86400000 + 1) * 2;
}

function assertLeaveBalance(balance, leaveType, days) {
  if (leaveType.kind !== 'unpaid' && (!balance ||
      balance.entitledHalfDays + balance.carryOverHalfDays - balance.usedHalfDays < days)) {
    const error = setupConflict('Insufficient leave balance for this request.');
    error.code = 'LEAVE_BALANCE_INSUFFICIENT';
    throw error;
  }
}

export const memoryStaffBundle = {
  async assertStaffCapacity(organizationId, additional = 1) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    if (plan?.staffLimit == null) return;
    const campusIds = new Set(this.campuses.filter((campus) =>
      campus.organizationId === organizationId).map((campus) => campus.id));
    const count = this.staff.filter((staff) =>
      campusIds.has(staff.campusId) && !staff.archivedAt && staff.employmentStatus !== 'terminated').length;
    if (count + additional > plan.staffLimit) throw planLimitError('staff', plan.staffLimit);
  },
  async listDepartments(campusId) {
    return this.departments.filter((department) => department.campusId === campusId);
  },
  async createDepartment(data, actor) {
    if (this.departments.some((department) => department.campusId === actor.activeCampusId &&
      department.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('Department name already exists at this campus.');
    }
    const department = { id: randomUUID(), campusId: actor.activeCampusId, ...data };
    this.departments.push(department);
    await this.appendAudit(actor, 'department.created', 'department', department.id, null, department);
    return department;
  },
  async listStaff(actor) {
    if (['principal', 'registrar'].includes(actor.role)) {
      return this.staff.filter((item) =>
        item.campusId === actor.activeCampusId && !item.archivedAt)
        .map((staff) => this.mapStaffWithWorkload(staff));
    }
    return this.visibleStaff(actor).map((staff) => this.mapStaffWithWorkload(staff));
  },
  async createStaff(data, actor) {
    await this.assertStaffCapacity(actor.orgId, 1);
    if (data.departmentId && !this.departments.some((item) =>
      item.id === data.departmentId && item.campusId === actor.activeCampusId)) {
      throw campusScopeError('Department is outside the active campus.');
    }
    if (data.userId) {
      const linkedUser = this.users.find((item) =>
        item.id === data.userId && item.orgId === actor.orgId && item.campusIds.includes(actor.activeCampusId));
      if (!linkedUser) throw campusScopeError('Linked account is outside the active campus organization.');
      if (this.staff.some((item) => item.userId === data.userId)) {
        throw setupConflict('Account is already linked to a staff profile.');
      }
    }
    const staff = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId, ...data,
      departmentId: data.departmentId ?? null, userId: data.userId ?? null,
      qualification: data.qualification ?? '', employmentStatus: data.employmentStatus ?? 'active',
      hiredOn: data.hiredOn ?? null, archivedAt: null
    };
    this.staff.push(staff);
    try {
      await this.appendAudit(actor, 'staff.created', 'staff', staff.id, null, staff);
    } catch (error) {
      const index = this.staff.findIndex((item) => item.id === staff.id);
      if (index >= 0) this.staff.splice(index, 1);
      throw error;
    }
    return this.mapStaffWithWorkload(staff);
  },
  async createTeachingAssignment(data, actor) {
    const staff = this.staff.find((item) =>
      item.id === data.staffId && item.campusId === actor.activeCampusId && !item.archivedAt);
    const section = this.sections.find((item) =>
      item.id === data.sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const subject = this.subjects.find((item) =>
      item.id === data.subjectId && item.campusId === actor.activeCampusId);
    if (!staff || !section || !subject) throw campusScopeError('Staff, section or subject is outside the active campus.');
    if (!await this.sectionHasSubject(section, subject.id)) {
      throw setupConflict('This subject is not included in the selected grade and stream.');
    }
    if (this.teachingAssignments.some((item) =>
      item.staffId === staff.id && item.sectionId === section.id && item.subjectId === subject.id && item.isActive)) {
      throw setupConflict('This teacher is already assigned to this section and subject.');
    }
    const room = data.roomId
      ? this.rooms.find((item) => item.id === data.roomId && item.campusId === actor.activeCampusId && item.isActive)
      : null;
    if (data.roomId && !room) throw campusScopeError('Room is outside the active campus.');
    if (data.dayOfWeek != null) {
      if (!this.timetablePeriods.some((item) => item.campusId === actor.activeCampusId &&
          item.shift === (section.shift ?? 'morning') && item.periodNumber === data.periodNumber)) {
        throw setupConflict('Configure this period for the section shift before assigning a timetable slot.');
      }
      if (this.teachingAssignments.some((item) =>
        item.isActive && item.dayOfWeek === data.dayOfWeek && item.periodNumber === data.periodNumber &&
        (item.staffId === staff.id || item.sectionId === section.id || (room && item.roomId === room.id)))) {
        throw scheduleConflict('Teacher, section or room already has an assignment in this timetable period.');
      }
    }
    const assignment = {
      id: randomUUID(), campusId: actor.activeCampusId, staffId: staff.id,
      sectionId: section.id, subjectId: subject.id,
      roomId: room?.id ?? null, roomName: room?.name ?? '', shift: section.shift ?? 'morning',
      dayOfWeek: data.dayOfWeek ?? null, periodNumber: data.periodNumber ?? null, isActive: true
    };
    this.teachingAssignments.push(assignment);
    await this.appendAudit(actor, 'teaching_assignment.created', 'teaching_assignment', assignment.id, null, assignment);
    return this.mapAssignment(assignment);
  },
  async listTeachingAssignments(actor) {
    const visibleIds = new Set(this.visibleStaff(actor).map((staff) => staff.id));
    return this.teachingAssignments.filter((item) =>
      item.campusId === actor.activeCampusId && item.isActive && visibleIds.has(item.staffId))
      .map((item) => this.mapAssignment(item));
  },
  async assignHomeroom(sectionId, staffId, actor) {
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const staff = this.staff.find((item) =>
      item.id === staffId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!section || !staff) throw campusScopeError('Staff or section is outside the active campus.');
    const previous = this.homeroomAssignments.find((item) => item.sectionId === sectionId);
    const before = previous ? { ...previous } : null;
    const assignment = { campusId: actor.activeCampusId, sectionId, staffId };
    if (previous) Object.assign(previous, assignment);
    else this.homeroomAssignments.push(assignment);
    await this.appendAudit(actor, 'homeroom.assigned', 'section', sectionId, before, assignment);
    return {
      sectionId, staffId, staffName: formatStaffName(staff), sectionName: section.name
    };
  },
  async recordStaffAttendance(data, actor) {
    const staff = await this.resolveStaff(data.staffId, actor);
    const prior = this.staffAttendance.find((item) =>
      item.campusId === actor.activeCampusId && item.staffId === staff.id && item.date === data.date);
    const before = prior ? { ...prior } : null;
    const record = prior ?? { id: randomUUID(), campusId: actor.activeCampusId, staffId: staff.id, date: data.date };
    Object.assign(record, {
      status: data.status, clockIn: data.clockIn ?? null, clockOut: data.clockOut ?? null,
      recordedBy: actor.sub
    });
    if (!prior) this.staffAttendance.unshift(record);
    await this.appendAudit(actor, prior ? 'staff_attendance.updated' : 'staff_attendance.recorded',
      'staff_attendance', record.id, before, record);
    return { ...this.mapStaffAttendance(record), duplicate: Boolean(prior) };
  },
  async listStaffAttendance(actor) {
    const visibleIds = new Set(this.visibleStaff(actor).map((staff) => staff.id));
    return this.staffAttendance.filter((item) =>
      item.campusId === actor.activeCampusId && visibleIds.has(item.staffId))
      .map((item) => ({
        ...this.mapStaffAttendance(item),
        name: formatStaffName(this.staff.find((staff) => staff.id === item.staffId)),
        department: this.departments.find((department) =>
          department.id === this.staff.find((staff) => staff.id === item.staffId)?.departmentId)?.name ?? ''
      }));
  },
  async createLeaveRequest(data, actor) {
    const staff = await this.resolveStaff(data.staffId, actor);
    const leaveType = data.leaveTypeId && this.hrLeaveTypes.find((item) =>
      item.id === data.leaveTypeId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId && item.isActive);
    if (data.leaveTypeId && !leaveType) throw campusScopeError('Leave type is outside the active campus.');
    if (this.leaveRequests.some((item) => item.staffId === staff.id &&
        ['pending', 'approved'].includes(item.status) &&
        item.startDate <= data.endDate && data.startDate <= item.endDate)) {
      throw setupConflict('This staff member already has overlapping leave.');
    }
    const requestedHalfDays = leaveHalfDays(data);
    if (leaveType) {
      const year = Number(data.startDate.slice(0, 4));
      const balance = this.hrLeaveBalances.find((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.staffId === staff.id && item.leaveTypeId === leaveType.id && item.year === year);
      assertLeaveBalance(balance, leaveType, requestedHalfDays);
    }
    const leave = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId, staffId: staff.id,
      startDate: data.startDate, endDate: data.endDate, reason: data.reason,
      leaveTypeId: data.leaveTypeId ?? null, requestedHalfDays,
      status: 'pending', reviewedBy: null, reviewNote: '', reviewedAt: null
    };
    this.leaveRequests.unshift(leave);
    await this.appendAudit(actor, 'leave.requested', 'leave_request', leave.id, null, leave);
    return this.mapLeaveRequest(leave);
  },
  async listLeaveRequests(actor) {
    const visibleIds = new Set(this.visibleStaff(actor).map((staff) => staff.id));
    return this.leaveRequests.filter((item) =>
      item.campusId === actor.activeCampusId && visibleIds.has(item.staffId))
      .map((item) => this.mapLeaveRequest(item));
  },
  async reviewLeaveRequest(leaveId, data, actor) {
    const leave = this.leaveRequests.find((item) =>
      item.id === leaveId && item.organizationId === actor.orgId &&
      item.campusId === actor.activeCampusId);
    if (!leave) return null;
    if (leave.status !== 'pending') throw setupConflict('Only pending leave requests can be reviewed.');
    if (data.decision === 'approved' && leave.leaveTypeId) {
      const leaveType = this.hrLeaveTypes.find((item) => item.id === leave.leaveTypeId &&
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
      const balance = this.hrLeaveBalances.find((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.staffId === leave.staffId && item.leaveTypeId === leave.leaveTypeId &&
        item.year === Number(leave.startDate.slice(0, 4)));
      assertLeaveBalance(balance, leaveType, leave.requestedHalfDays);
      if (leaveType.kind !== 'unpaid') balance.usedHalfDays += leave.requestedHalfDays;
    }
    const before = { ...leave };
    Object.assign(leave, {
      status: data.decision, reviewedBy: actor.sub, reviewNote: data.note, reviewedAt: now()
    });
    await this.appendAudit(actor, `leave.${data.decision}`, 'leave_request', leave.id, before, leave);
    const leaveStaff = this.staff.find((item) => item.id === leave.staffId);
    this.addHrNotifications(actor, 'hr_leave_decision', leave.id,
      'Leave request updated', `Your leave request was ${data.decision}.`, [leaveStaff?.userId]);
    return this.mapLeaveRequest(leave);
  },
  visibleStaff(actor) {
    const allStaffRoles = ['owner_director', 'group_executive', 'hr_admin', 'system_admin'];
    if (allStaffRoles.includes(actor.role)) {
      return this.staff.filter((item) => item.campusId === actor.activeCampusId && !item.archivedAt);
    }
    const actorStaff = this.staff.find((item) =>
      item.userId === actor.sub && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!actorStaff) return [];
    if (['principal', 'academic_head'].includes(actor.role)) {
      return this.staff.filter((item) => item.campusId === actor.activeCampusId &&
        item.departmentId === actorStaff.departmentId && !item.archivedAt);
    }
    return [actorStaff];
  },
  mapStaffWithWorkload(staff) {
    const department = this.departments.find((item) => item.id === staff.departmentId);
    const assignments = this.teachingAssignments.filter((item) => item.staffId === staff.id && item.isActive);
    const homerooms = this.homeroomAssignments.filter((item) => item.staffId === staff.id);
    return {
      ...staff, name: formatStaffName(staff), departmentName: department?.name ?? '',
      teachingAssignmentCount: assignments.length, homeroomCount: homerooms.length
    };
  },
  mapAssignment(item) {
    const staff = this.staff.find((row) => row.id === item.staffId);
    const section = this.sections.find((row) => row.id === item.sectionId);
    const subject = this.subjects.find((row) => row.id === item.subjectId);
    return {
      ...item, staffName: formatStaffName(staff),
      sectionName: section?.name ?? '', subjectName: subject?.nameEn ?? '',
      departmentId: staff?.departmentId ?? null
    };
  },
  mapStaffAttendance(record) {
    return {
      id: record.id, staffId: record.staffId, date: record.date,
      status: record.status, clockIn: record.clockIn, clockOut: record.clockOut
    };
  },
  mapLeaveRequest(leave) {
    const staff = this.staff.find((item) => item.id === leave.staffId);
    return { ...leave, staffName: formatStaffName(staff) };
  },
  async resolveStaff(staffId, actor) {
    const targetId = staffId ?? this.staff.find((item) =>
      item.userId === actor.sub && item.campusId === actor.activeCampusId)?.id;
    const staff = this.staff.find((item) =>
      item.id === targetId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!staff) throw campusScopeError('Staff profile is not available at this campus.');
    const canManage = ['owner_director', 'principal', 'hr_admin', 'system_admin'].includes(actor.role);
    if (!canManage && staff.userId !== actor.sub) throw campusScopeError('Staff may only access their own records.');
    return staff;
  }
};
