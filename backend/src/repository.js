import bcrypt from 'bcrypt';
import knexFactory from 'knex';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const now = () => new Date().toISOString();
const addisDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export class MemoryRepository {
  constructor({ users, campuses, sections, academicYears, gradeLevels = [], subjects = [], staff = [], departments = [] }) {
    this.users = users;
    this.campuses = campuses;
    this.sections = sections;
    this.academicYears = academicYears;
    this.gradeLevels = gradeLevels;
    this.subjects = subjects;
    this.staff = staff;
    this.departments = departments;
    this.admissions = [];
    this.admissionDocuments = [];
    this.studentStatusHistory = [];
    this.studentSiblingLinks = [];
    this.admissionCounters = new Map();
    this.teachingAssignments = [];
    this.homeroomAssignments = [];
    this.staffAttendance = [];
    this.leaveRequests = [];
    this.staffMessages = [];
    this.students = [];
    this.attendance = [];
    this.marks = [];
    this.audit = [];
    this.loginFailures = new Map();
    this.refreshTokens = new Map();
    this.mode = 'memory';
  }

  async findUserByLogin(login) {
    return this.users.find((user) =>
      user.email?.toLowerCase() === login.toLowerCase() || user.phone === login) ?? null;
  }
  async findUserById(id) { return this.users.find((user) => user.id === id) ?? null; }
  async recordLoginFailure(login) {
    const item = this.loginFailures.get(login) ?? { count: 0, since: Date.now() };
    if (Date.now() - item.since > 15 * 60_000) {
      item.count = 0;
      item.since = Date.now();
    }
    item.count += 1;
    this.loginFailures.set(login, item);
    return item.count;
  }
  async clearLoginFailures(login) { this.loginFailures.delete(login); }
  async storeRefreshToken(tokenHash, userId, expiresAt) {
    this.refreshTokens.set(tokenHash, { userId, expiresAt });
  }
  async consumeRefreshToken(tokenHash) {
    const row = this.refreshTokens.get(tokenHash);
    if (!row || new Date(row.expiresAt) <= new Date()) return null;
    this.refreshTokens.delete(tokenHash);
    return this.findUserById(row.userId);
  }
  async revokeRefreshToken(tokenHash) { this.refreshTokens.delete(tokenHash); }
  async listStudents(campusId) {
    return this.students.filter((student) => student.campusId === campusId && !student.archivedAt);
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return this.listStudents(actor.activeCampusId);
    const names = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return (await this.listStudents(actor.activeCampusId)).filter((student) => names.has(student.sectionName));
  }
  async createStudent(data, actor) {
    const section = this.sections.find((item) =>
      item.campusId === actor.activeCampusId && item.name === data.sectionName && item.isActive);
    if (!section) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const duplicate = this.students.some((student) =>
      student.campusId === actor.activeCampusId && student.studentNo === data.studentNo);
    if (duplicate) {
      const error = new Error('Student number is already in use at this campus.');
      error.code = 'STUDENT_NO_CONFLICT';
      throw error;
    }
    const student = {
      id: randomUUID(), ...data, campusId: actor.activeCampusId,
      status: 'enrolled', createdAt: now()
    };
    this.students.unshift(student);
    await this.appendAudit(actor, 'student.created', 'student', student.id, null, student);
    return student;
  }
  async hasStudents(campusId, ids) {
    const found = this.students.filter((s) => s.campusId === campusId && ids.includes(s.id));
    return found.length === ids.length;
  }
  async listSections(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    return this.sections.filter((section) => section.campusId === campusId && section.isActive &&
      (accessible === null || accessible.has(section.id)));
  }
  async accessibleSectionIds(actor) {
    if (!['homeroom_teacher', 'subject_teacher'].includes(actor.role)) return null;
    const staff = this.staff.find((item) =>
      item.userId === actor.sub && item.campusId === actor.activeCampusId);
    if (!staff) return new Set();
    return new Set([
      ...this.teachingAssignments.filter((item) => item.staffId === staff.id && item.isActive)
        .map((item) => item.sectionId),
      ...this.homeroomAssignments.filter((item) => item.staffId === staff.id)
        .map((item) => item.sectionId)
    ]);
  }
  async hasSection(campusId, sectionId) {
    return this.sections.some((section) => section.campusId === campusId && section.id === sectionId && section.isActive);
  }
  async hasStudentsInSection(campusId, sectionId, ids) {
    const section = this.sections.find((item) => item.campusId === campusId && item.id === sectionId && item.isActive);
    if (!section) return false;
    const found = this.students.filter((student) =>
      student.campusId === campusId && student.sectionName === section.name && ids.includes(student.id));
    return found.length === ids.length;
  }
  async hasStudentsInSections(campusId, sectionIds, ids) {
    const allowed = new Set(sectionIds);
    const sectionNames = new Set(this.sections.filter((section) => allowed.has(section.id)).map((section) => section.name));
    const rows = this.students.filter((student) =>
      student.campusId === campusId && sectionNames.has(student.sectionName) && ids.includes(student.id));
    return rows.length === ids.length;
  }
  async listRoster(actor, sectionId) {
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const accessible = await this.accessibleSectionIds(actor);
    if (!section || (accessible && !accessible.has(sectionId))) throw campusScopeError('Section is not accessible.');
    return (await this.listStudents(actor.activeCampusId))
      .filter((student) => student.sectionName === section.name);
  }
  async getAcademicYear(campusId) {
    return this.academicYears.find((year) => year.campusId === campusId && year.status === 'active') ?? null;
  }
  async listAcademicYears(campusId) {
    return this.academicYears.filter((year) => year.campusId === campusId);
  }
  async createAcademicYear(data, actor) {
    if (this.academicYears.some((year) => year.campusId === actor.activeCampusId && year.labelEc === data.labelEc)) {
      throw setupConflict('Academic-year label already exists at this campus.');
    }
    const year = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data, status: 'planned'
    };
    this.academicYears.push(year);
    await this.appendAudit(actor, 'academic_year.created', 'academic_year', year.id, null, year);
    return year;
  }
  async activateAcademicYear(yearId, actor) {
    const year = this.academicYears.find((item) =>
      item.id === yearId && item.campusId === actor.activeCampusId);
    if (!year) return null;
    const before = this.academicYears
      .filter((item) => item.campusId === actor.activeCampusId && item.status === 'active')
      .map(({ id, labelEc }) => ({ id, labelEc }));
    for (const item of this.academicYears) {
      if (item.campusId === actor.activeCampusId && item.status === 'active') {
        item.status = 'closed';
        if (item.id !== yearId) for (const term of item.terms ?? []) term.isCurrent = false;
      }
    }
    year.status = 'active';
    await this.appendAudit(actor, 'academic_year.activated', 'academic_year', year.id, before, year);
    return year;
  }
  async listTerms(campusId) {
    return this.academicYears.filter((year) => year.campusId === campusId)
      .flatMap((year) => (year.terms ?? []).map((term) => ({ ...term, academicYearId: year.id })));
  }
  async createTerm(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    if (!year) throw setupConflict('Create or activate an academic year before adding terms.');
    if (data.startDate < year.startDate || data.endDate > year.endDate) {
      const error = new Error('Term dates must be within the active academic year.');
      error.status = 400;
      error.code = 'TERM_OUTSIDE_ACADEMIC_YEAR';
      throw error;
    }
    year.terms ??= [];
    if (year.terms.some((term) => term.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('Term name already exists in the active academic year.');
    }
    const term = { id: randomUUID(), ...data, isCurrent: year.terms.length === 0 };
    year.terms.push(term);
    await this.appendAudit(actor, 'term.created', 'term', term.id, null, term);
    return { ...term, academicYearId: year.id };
  }
  async listGrades(campusId) {
    return this.gradeLevels.filter((grade) => grade.campusId === campusId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async createGrade(data, actor) {
    if (this.gradeLevels.some((grade) => grade.campusId === actor.activeCampusId && grade.code === data.code)) {
      throw setupConflict('Grade code already exists at this campus.');
    }
    const grade = { id: randomUUID(), campusId: actor.activeCampusId, ...data };
    this.gradeLevels.push(grade);
    await this.appendAudit(actor, 'grade_level.created', 'grade_level', grade.id, null, grade);
    return grade;
  }
  async listSubjects(campusId) {
    return this.subjects.filter((subject) => subject.campusId === campusId);
  }
  async createSubject(data, actor) {
    if (this.subjects.some((subject) => subject.campusId === actor.activeCampusId && subject.code === data.code)) {
      throw setupConflict('Subject code already exists at this campus.');
    }
    const subject = { id: randomUUID(), campusId: actor.activeCampusId, ...data };
    this.subjects.push(subject);
    await this.appendAudit(actor, 'subject.created', 'subject', subject.id, null, subject);
    return subject;
  }
  async createSection(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    if (!year || !grade) throw campusScopeError('Grade or active academic year is not available at this campus.');
    const duplicate = this.sections.some((section) =>
      section.campusId === actor.activeCampusId && section.name.toLowerCase() === data.name.toLowerCase());
    if (duplicate) throw setupConflict('Section name already exists in the active academic year.');
    const section = {
      id: randomUUID(), campusId: actor.activeCampusId, academicYearId: year.id,
      gradeLevelId: grade.id, gradeName: grade.nameEn, name: data.name,
      capacity: data.capacity ?? null, isActive: true
    };
    this.sections.push(section);
    await this.appendAudit(actor, 'section.created', 'section', section.id, null, section);
    return section;
  }
  async saveAttendance(data, actor) {
    const existing = this.attendance.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
    if (!await this.hasSection(actor.activeCampusId, data.sectionId)) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessibleSections = await this.accessibleSectionIds(actor);
    if (accessibleSections && !accessibleSections.has(data.sectionId)) {
      throw campusScopeError('Teacher is not assigned to this section.');
    }
    if (!await this.hasStudentsInSection(actor.activeCampusId, data.sectionId, data.records.map((r) => r.studentId))) {
      const error = new Error('Attendance includes a student outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const session = {
      id: randomUUID(), campusId: actor.activeCampusId, date: data.date,
      sectionId: data.sectionId, clientUuid: data.clientUuid,
      records: data.records, takenBy: actor.sub, createdAt: now()
    };
    this.attendance.unshift(session);
    await this.appendAudit(actor, 'attendance.recorded', 'attendance_session', session.id, null, session);
    return session;
  }
  async listAttendance(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    return this.attendance.filter((item) => item.campusId === campusId &&
      (accessible === null || accessible.has(item.sectionId)));
  }
  async saveMark(data, actor) {
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [data.studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    const existing = this.marks.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
    const mark = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data, state: 'draft',
      enteredBy: actor.sub, createdAt: now()
    };
    this.marks.unshift(mark);
    await this.appendAudit(actor, 'mark.created', 'mark', mark.id, null, mark);
    return mark;
  }
  async listMarks(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible === null) return this.marks.filter((item) => item.campusId === campusId);
    const sectionNames = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return this.marks.filter((item) => item.campusId === campusId &&
      sectionNames.has(this.students.find((student) => student.id === item.studentId)?.sectionName));
  }
  async getDashboard(campusId) {
    const students = await this.listStudents(campusId);
    const attendance = await this.listAttendance(campusId);
    const marks = await this.listMarks(campusId);
    const sectionCounts = new Map();
    const genderTotals = { female: 0, male: 0, other: 0 };
    for (const student of students) {
      const section = student.sectionName || 'Unassigned';
      sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
      genderTotals[student.gender] = (genderTotals[student.gender] ?? 0) + 1;
    }
    return {
      studentCount: students.length,
      attendanceSessions: attendance.length,
      marksRecorded: marks.length,
      attendanceToday: attendance.filter((x) => x.date === addisDate()).length,
      recentStudents: students.slice(0, 5),
      sectionDistribution: [...sectionCounts].map(([sectionName, count]) => ({ sectionName, count })),
      genderTotals,
      mode: this.mode
    };
  }
  async appendAudit(actor, action, entityType, entityId, before, after) {
    this.audit.push({
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      actorId: actor.sub, action, entityType, entityId, before, after, createdAt: now()
    });
  }
  async getCampus(campusId) { return this.campuses.find((campus) => campus.id === campusId) ?? null; }
  async updateCampus(data, actor) {
    const campus = await this.getCampus(actor.activeCampusId);
    if (!campus) return null;
    const before = { ...campus };
    Object.assign(campus, data);
    await this.appendAudit(actor, 'school.profile_updated', 'campus', campus.id, before, campus);
    return campus;
  }
  async listDepartments(campusId) {
    return this.departments.filter((department) => department.campusId === campusId);
  }
  async createDepartment(data, actor) {
    if (this.departments.some((department) => department.campusId === actor.activeCampusId &&
      department.name.toLowerCase() === data.name.toLowerCase())) {
      throw setupConflict('Department name already exists at this campus.');
    }
    const department = { id: randomUUID(), campusId: actor.activeCampusId, ...data };
    this.departments.push(department);
    await this.appendAudit(actor, 'department.created', 'department', department.id, null, department);
    return department;
  }
  async listStaff(actor) {
    return this.visibleStaff(actor).map((staff) => this.mapStaffWithWorkload(staff));
  }
  async createStaff(data, actor) {
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
      id: randomUUID(), campusId: actor.activeCampusId, ...data,
      departmentId: data.departmentId ?? null, userId: data.userId ?? null,
      qualification: data.qualification ?? '', employmentStatus: data.employmentStatus ?? 'active',
      hiredOn: data.hiredOn ?? null, archivedAt: null
    };
    this.staff.push(staff);
    await this.appendAudit(actor, 'staff.created', 'staff', staff.id, null, staff);
    return this.mapStaffWithWorkload(staff);
  }
  async createTeachingAssignment(data, actor) {
    const staff = this.staff.find((item) =>
      item.id === data.staffId && item.campusId === actor.activeCampusId && !item.archivedAt);
    const section = this.sections.find((item) =>
      item.id === data.sectionId && item.campusId === actor.activeCampusId && item.isActive);
    const subject = this.subjects.find((item) =>
      item.id === data.subjectId && item.campusId === actor.activeCampusId);
    if (!staff || !section || !subject) throw campusScopeError('Staff, section or subject is outside the active campus.');
    if (this.teachingAssignments.some((item) =>
      item.staffId === staff.id && item.sectionId === section.id && item.subjectId === subject.id && item.isActive)) {
      throw setupConflict('This teacher is already assigned to this section and subject.');
    }
    if (data.dayOfWeek != null && this.teachingAssignments.some((item) =>
      item.isActive && item.dayOfWeek === data.dayOfWeek && item.periodNumber === data.periodNumber &&
      (item.staffId === staff.id || item.sectionId === section.id))) {
      throw scheduleConflict('Teacher or section already has an assignment in this timetable period.');
    }
    const assignment = {
      id: randomUUID(), campusId: actor.activeCampusId, staffId: staff.id,
      sectionId: section.id, subjectId: subject.id,
      dayOfWeek: data.dayOfWeek ?? null, periodNumber: data.periodNumber ?? null, isActive: true
    };
    this.teachingAssignments.push(assignment);
    await this.appendAudit(actor, 'teaching_assignment.created', 'teaching_assignment', assignment.id, null, assignment);
    return this.mapAssignment(assignment);
  }
  async listTeachingAssignments(actor) {
    const visibleIds = new Set(this.visibleStaff(actor).map((staff) => staff.id));
    return this.teachingAssignments.filter((item) =>
      item.campusId === actor.activeCampusId && item.isActive && visibleIds.has(item.staffId))
      .map((item) => this.mapAssignment(item));
  }
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
  }
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
  }
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
  }
  async createLeaveRequest(data, actor) {
    const staff = await this.resolveStaff(data.staffId, actor);
    const leave = {
      id: randomUUID(), campusId: actor.activeCampusId, staffId: staff.id,
      startDate: data.startDate, endDate: data.endDate, reason: data.reason,
      status: 'pending', reviewedBy: null, reviewNote: '', reviewedAt: null
    };
    this.leaveRequests.unshift(leave);
    await this.appendAudit(actor, 'leave.requested', 'leave_request', leave.id, null, leave);
    return this.mapLeaveRequest(leave);
  }
  async listLeaveRequests(actor) {
    const visibleIds = new Set(this.visibleStaff(actor).map((staff) => staff.id));
    return this.leaveRequests.filter((item) =>
      item.campusId === actor.activeCampusId && visibleIds.has(item.staffId))
      .map((item) => this.mapLeaveRequest(item));
  }
  async reviewLeaveRequest(leaveId, data, actor) {
    const leave = this.leaveRequests.find((item) =>
      item.id === leaveId && item.campusId === actor.activeCampusId);
    if (!leave) return null;
    if (leave.status !== 'pending') throw setupConflict('Only pending leave requests can be reviewed.');
    const before = { ...leave };
    Object.assign(leave, {
      status: data.decision, reviewedBy: actor.sub, reviewNote: data.note, reviewedAt: now()
    });
    await this.appendAudit(actor, `leave.${data.decision}`, 'leave_request', leave.id, before, leave);
    return this.mapLeaveRequest(leave);
  }
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
  }
  async listStaffMessages(actor) {
    const staff = this.staff.find((item) => item.userId === actor.sub && item.campusId === actor.activeCampusId);
    return this.staffMessages.filter((item) =>
      item.campusId === actor.activeCampusId &&
      (!item.departmentId || item.departmentId === staff?.departmentId));
  }
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
  }
  mapStaffWithWorkload(staff) {
    const department = this.departments.find((item) => item.id === staff.departmentId);
    const assignments = this.teachingAssignments.filter((item) => item.staffId === staff.id && item.isActive);
    const homerooms = this.homeroomAssignments.filter((item) => item.staffId === staff.id);
    return {
      ...staff, name: formatStaffName(staff), departmentName: department?.name ?? '',
      teachingAssignmentCount: assignments.length, homeroomCount: homerooms.length
    };
  }
  mapAssignment(item) {
    const staff = this.staff.find((row) => row.id === item.staffId);
    const section = this.sections.find((row) => row.id === item.sectionId);
    const subject = this.subjects.find((row) => row.id === item.subjectId);
    return {
      ...item, staffName: formatStaffName(staff),
      sectionName: section?.name ?? '', subjectName: subject?.nameEn ?? '',
      departmentId: staff?.departmentId ?? null
    };
  }
  mapStaffAttendance(record) {
    return {
      id: record.id, staffId: record.staffId, date: record.date,
      status: record.status, clockIn: record.clockIn, clockOut: record.clockOut
    };
  }
  mapLeaveRequest(leave) {
    const staff = this.staff.find((item) => item.id === leave.staffId);
    return { ...leave, staffName: formatStaffName(staff) };
  }
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
  async getAdmissionsDashboard(campusId) {
    const rows = this.admissions.filter((item) => item.campusId === campusId);
    const byStatus = Object.fromEntries([
      'enquiry', 'application', 'interview', 'accepted', 'waitlisted',
      'rejected', 'enrolled', 'withdrawn', 'transferred_out'
    ].map((status) => [status, rows.filter((item) => item.status === status).length]));
    const byGrade = new Map();
    for (const row of rows) {
      const grade = this.gradeLevels.find((item) => item.id === row.gradeLevelId);
      const label = grade?.nameEn ?? row.gradeLevelId;
      const current = byGrade.get(label) ?? { grade: label, total: 0, enrolled: 0 };
      current.total += 1;
      if (row.status === 'enrolled') current.enrolled += 1;
      byGrade.set(label, current);
    }
    return { total: rows.length, byStatus, byGrade: [...byGrade.values()] };
  }
  async listAdmissions(campusId, { status = null, query = '' } = {}) {
    const needle = query.toLocaleLowerCase();
    return this.admissions.filter((item) =>
      item.campusId === campusId && (!status || item.status === status) &&
      (!needle || [
        item.givenNameEn, item.fatherNameEn, item.grandfatherNameEn,
        item.givenNameAm, item.fatherNameAm, item.grandfatherNameAm,
        item.guardianPhone, item.guardianName
      ].some((value) => value?.toLocaleLowerCase().includes(needle))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => this.mapAdmission(item));
  }
  async getAdmission(campusId, admissionId) {
    const item = this.admissions.find((row) => row.id === admissionId && row.campusId === campusId);
    return item ? this.mapAdmission(item) : null;
  }
  async findAdmissionDuplicates(campusId, { name = '', dateOfBirth = '', guardianPhone = '' }) {
    const needle = name.trim().toLocaleLowerCase();
    const matchesName = (item) => needle && (
      `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`.toLocaleLowerCase() === needle ||
      `${item.givenNameAm} ${item.fatherNameAm} ${item.grandfatherNameAm}`.toLocaleLowerCase() === needle
    );
    const admissions = this.admissions.filter((item) =>
      item.campusId === campusId && (
        (guardianPhone && item.guardianPhone === guardianPhone) ||
        (dateOfBirth && item.dateOfBirth === dateOfBirth && matchesName(item))
      )).map((item) => ({ id: item.id, type: 'admission', status: item.status, name: `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`, guardianPhone: item.guardianPhone }));
    const students = this.students.filter((item) =>
      item.campusId === campusId && (
        (guardianPhone && item.guardianPhone === guardianPhone) ||
        (dateOfBirth && item.dateOfBirth === dateOfBirth && matchesName(item))
      )).map((item) => ({ id: item.id, type: 'student', status: item.status, name: `${item.givenNameEn} ${item.fatherNameEn} ${item.grandfatherNameEn}`, guardianPhone: item.guardianPhone ?? '' }));
    return [...admissions, ...students];
  }
  async createAdmission(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = this.gradeLevels.find((item) =>
      item.id === data.gradeLevelId && item.campusId === actor.activeCampusId);
    if (!year || !grade) throw campusScopeError('An active academic year and campus grade are required.');
    const admission = {
      id: randomUUID(), organizationId: actor.orgId, campusId: actor.activeCampusId,
      academicYearId: year.id, ...data, dateOfBirth: data.dateOfBirth ?? null,
      guardianEmail: data.guardianEmail ?? null, previousSchool: data.previousSchool ?? null,
      status: 'enquiry', requiredDocuments: ['birth_certificate', 'previous_school_report', 'guardian_id'],
      interviewAt: null, interviewResult: null, decisionNote: '', sectionId: null, studentId: null,
      siblingStudentId: null, createdBy: actor.sub, createdAt: now()
    };
    this.admissions.unshift(admission);
    await this.appendAudit(actor, 'admission.created', 'admission', admission.id, null, admission);
    return this.mapAdmission(admission);
  }
  mapAdmission(item) {
    const documents = this.admissionDocuments.filter((doc) => doc.admissionId === item.id);
    return {
      ...item,
      documentChecklist: item.requiredDocuments.map((type) => ({
        type, complete: documents.some((doc) => doc.documentType === type)
      })),
      documents: documents.map((doc) => this.mapAdmissionDocument(doc)),
      gradeName: this.gradeLevels.find((grade) => grade.id === item.gradeLevelId)?.nameEn ?? '',
      studentNo: this.students.find((student) => student.id === item.studentId)?.studentNo ?? null
    };
  }
  async scheduleAdmissionInterview(admissionId, data, actor) {
    const item = this.admissions.find((row) =>
      row.id === admissionId && row.campusId === actor.activeCampusId);
    if (!item) return null;
    if (!['application', 'interview'].includes(item.status)) throw setupConflict('Only applicants may be scheduled for an interview.');
    const before = { interviewAt: item.interviewAt, interviewResult: item.interviewResult, status: item.status };
    item.status = 'interview';
    item.interviewAt = data.interviewAt;
    item.interviewResult = data.interviewResult;
    await this.appendAudit(actor, 'admission.interview_scheduled', 'admission', item.id, before, item);
    return this.mapAdmission(item);
  }
  async updateAdmissionStatus(admissionId, data, actor) {
    const item = this.admissions.find((row) =>
      row.id === admissionId && row.campusId === actor.activeCampusId);
    if (!item) return null;
    const allowed = {
      enquiry: ['application', 'rejected'], application: ['accepted', 'waitlisted', 'rejected', 'interview'],
      interview: ['accepted', 'waitlisted', 'rejected'], waitlisted: ['accepted', 'rejected']
    };
    if (!allowed[item.status]?.includes(data.status)) throw setupConflict(`Cannot move an admission from ${item.status} to ${data.status}.`);
    const before = { status: item.status, decisionNote: item.decisionNote };
    item.status = data.status;
    item.decisionNote = data.decisionNote;
    await this.appendAudit(actor, `admission.${data.status}`, 'admission', item.id, before, item);
    return this.mapAdmission(item);
  }
  async setStudentIdPattern(pattern, actor) {
    const campus = await this.getCampus(actor.activeCampusId);
    if (!campus) throw campusScopeError('Campus is not available.');
    const before = campus.studentIdPattern ?? '{CAMPUS}-{YEAR}-{SEQ}';
    campus.studentIdPattern = pattern;
    await this.appendAudit(actor, 'admission.student_id_pattern_updated', 'campus', campus.id, { pattern: before }, { pattern });
    return { pattern };
  }
  async storeAdmissionDocument(admissionId, documentType, originalName, mimeType, content, actor) {
    const admission = this.admissions.find((item) =>
      item.id === admissionId && item.campusId === actor.activeCampusId);
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content)) throw invalidDocument('The document content does not match its declared file type.');
    const document = {
      id: randomUUID(), admissionId, documentType, originalName: safeFilename(originalName),
      mimeType, sizeBytes: content.length, storageKey: randomUUID(),
      sha256: createHash('sha256').update(content).digest('hex'), uploadedBy: actor.sub, createdAt: now(),
      content: Buffer.from(content)
    };
    this.admissionDocuments.push(document);
    await this.appendAudit(actor, 'admission.document_uploaded', 'admission_document', document.id, null, {
      admissionId, documentType, sizeBytes: content.length, sha256: document.sha256
    });
    return this.mapAdmissionDocument(document);
  }
  async listAdmissionDocuments(campusId, admissionId) {
    if (!this.admissions.some((item) => item.id === admissionId && item.campusId === campusId)) return [];
    return this.admissionDocuments.filter((item) => item.admissionId === admissionId)
      .map((item) => this.mapAdmissionDocument(item));
  }
  async getAdmissionDocument(campusId, admissionId, documentId) {
    if (!this.admissions.some((item) => item.id === admissionId && item.campusId === campusId)) return null;
    const document = this.admissionDocuments.find((item) =>
      item.id === documentId && item.admissionId === admissionId);
    return document ? { document: this.mapAdmissionDocument(document), content: document.content } : null;
  }
  mapAdmissionDocument(document) {
    const { content, ...metadata } = document;
    return metadata;
  }
  async enrolAdmission(admissionId, { sectionId, siblingStudentId = null }, actor) {
    const admission = this.admissions.find((item) =>
      item.id === admissionId && item.campusId === actor.activeCampusId);
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (admission.status !== 'accepted') throw setupConflict('Only accepted applicants can be enrolled.');
    if (admission.requiredDocuments.some((type) =>
      !this.admissionDocuments.some((doc) => doc.admissionId === admissionId && doc.documentType === type))) {
      throw setupConflict('All required documents must be uploaded before enrolment.');
    }
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive &&
      item.gradeLevelId === admission.gradeLevelId);
    if (!section) throw campusScopeError('Select an active section for the applicant’s grade at this campus.');
    const enrolledCount = this.students.filter((student) =>
      student.campusId === actor.activeCampusId && student.sectionName === section.name && student.status === 'enrolled').length;
    if (section.capacity != null && enrolledCount >= section.capacity) throw setupConflict('The selected section has reached capacity.');
    if (siblingStudentId && !this.students.some((student) =>
      student.id === siblingStudentId && student.campusId === actor.activeCampusId && student.status === 'enrolled')) {
      throw campusScopeError('Sibling student is not enrolled at this campus.');
    }
    const year = this.academicYears.find((item) => item.id === admission.academicYearId);
    const count = (this.admissionCounters.get(`${actor.activeCampusId}:${admission.academicYearId}`) ?? 0) + 1;
    this.admissionCounters.set(`${actor.activeCampusId}:${admission.academicYearId}`, count);
    const campus = await this.getCampus(actor.activeCampusId);
    const studentNo = formatStudentNo(campus?.studentIdPattern, campus?.name, year?.labelEc, count);
    if (this.students.some((student) => student.campusId === actor.activeCampusId && student.studentNo === studentNo)) {
      throw setupConflict('Generated student number is already in use; review the campus ID pattern.');
    }
    const student = {
      id: randomUUID(), campusId: actor.activeCampusId, studentNo,
      givenNameAm: admission.givenNameAm, fatherNameAm: admission.fatherNameAm,
      grandfatherNameAm: admission.grandfatherNameAm, givenNameEn: admission.givenNameEn,
      fatherNameEn: admission.fatherNameEn, grandfatherNameEn: admission.grandfatherNameEn,
      gender: admission.gender, dateOfBirth: admission.dateOfBirth,
      guardianName: admission.guardianName, guardianPhone: admission.guardianPhone,
      sectionName: section.name, previousSchool: admission.previousSchool, status: 'enrolled', createdAt: now()
    };
    this.students.unshift(student);
    admission.sectionId = section.id;
    admission.studentId = student.id;
    admission.siblingStudentId = siblingStudentId;
    admission.status = 'enrolled';
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId: student.id, campusId: actor.activeCampusId,
      status: 'enrolled', reason: `Admission ${admission.id}`, recordedBy: actor.sub, createdAt: now()
    });
    if (siblingStudentId) this.studentSiblingLinks.push(
      { studentId: student.id, siblingStudentId, campusId: actor.activeCampusId, relationship: 'sibling' },
      { studentId: siblingStudentId, siblingStudentId: student.id, campusId: actor.activeCampusId, relationship: 'sibling' }
    );
    await this.appendAudit(actor, 'admission.enrolled', 'student', student.id, { admissionId, status: 'accepted' }, {
      studentNo, sectionId, siblingStudentId
    });
    return { student, admission: this.mapAdmission(admission) };
  }
  async changeStudentStatus(studentId, status, reason, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can be withdrawn or transferred.');
    const before = { status: student.status, sectionName: student.sectionName };
    student.status = status;
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission) linkedAdmission.status = status;
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status, reason, recordedBy: actor.sub, createdAt: now()
    });
    await this.appendAudit(actor, `student.${status}`, 'student', studentId, before, student);
    return student;
  }
  async readmitStudent(studentId, { sectionId, reason }, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) return null;
    if (student.status !== 'withdrawn') throw setupConflict('Only a withdrawn student can be readmitted.');
    const section = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive);
    if (!section) throw campusScopeError('Select an active section at this campus.');
    const count = this.students.filter((item) =>
      item.campusId === actor.activeCampusId && item.sectionName === section.name && item.status === 'enrolled').length;
    if (section.capacity != null && count >= section.capacity) throw setupConflict('The selected section has reached capacity.');
    const before = { status: student.status, sectionName: student.sectionName };
    student.status = 'enrolled';
    student.sectionName = section.name;
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission) linkedAdmission.status = 'enrolled';
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status: 'enrolled', reason, recordedBy: actor.sub, createdAt: now()
    });
    await this.appendAudit(actor, 'student.readmitted', 'student', studentId, before, student);
    return student;
  }
  async transferStudentOut(studentId, reason, actor) {
    return this.changeStudentStatus(studentId, 'transferred_out', reason, actor);
  }
  async getStudentTransferRecord(campusId, studentId) {
    const student = this.students.find((item) => item.id === studentId && item.campusId === campusId);
    const history = this.studentStatusHistory.find((item) =>
      item.studentId === studentId && item.campusId === campusId && item.status === 'transferred_out');
    return student && history ? { student, history, campus: await this.getCampus(campusId) } : null;
  }
  async close() {}
}

export class MysqlRepository {
  constructor(knex, privateDocumentsDir) {
    this.db = knex;
    this.mode = 'mysql';
    this.loginFailures = new Map();
    this.privateDocumentsDir = path.resolve(privateDocumentsDir);
  }
  async findUserByLogin(login) {
    const user = await this.db('users').whereRaw('LOWER(email) = ?', [login.toLowerCase()])
      .orWhere({ phone: login }).first();
    if (!user) return null;
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .where({
        'uc.user_id': user.id, 'uc.is_active': true,
        'c.organization_id': user.organization_id, 'c.is_active': true
      })
      .select('uc.campus_id');
    return {
      id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
      phone: user.phone, passwordHash: user.password_hash, role: user.role,
      campusIds: memberships.map((m) => m.campus_id), activeCampusId: memberships[0]?.campus_id,
      isActive: Boolean(user.is_active)
    };
  }
  async findUserById(id) {
    const user = await this.db('users').where({ id }).first();
    if (!user) return null;
    const memberships = await this.db('user_campuses as uc')
      .join('campuses as c', 'c.id', 'uc.campus_id')
      .where({
        'uc.user_id': id, 'uc.is_active': true,
        'c.organization_id': user.organization_id, 'c.is_active': true
      })
      .select('uc.campus_id');
    return {
      id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
      role: user.role, campusIds: memberships.map((m) => m.campus_id),
      activeCampusId: memberships[0]?.campus_id, isActive: Boolean(user.is_active)
    };
  }
  async recordLoginFailure(login) {
    const item = this.loginFailures.get(login) ?? { count: 0, since: Date.now() };
    if (Date.now() - item.since > 15 * 60_000) { item.count = 0; item.since = Date.now(); }
    item.count += 1; this.loginFailures.set(login, item);
    return item.count;
  }
  async clearLoginFailures(login) { this.loginFailures.delete(login); }
  async storeRefreshToken(tokenHash, userId, expiresAt) {
    await this.db('refresh_tokens').insert({
      id: randomUUID(), user_id: userId, token_hash: tokenHash, expires_at: expiresAt
    });
  }
  async consumeRefreshToken(tokenHash) {
    return this.db.transaction(async (trx) => {
      const row = await trx('refresh_tokens').where({ token_hash: tokenHash }).forUpdate().first();
      if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) return null;
      await trx('refresh_tokens').where({ id: row.id }).update({ revoked_at: trx.fn.now() });
      const user = await trx('users').where({ id: row.user_id }).first();
      if (!user || !user.is_active) return null;
      const memberships = await trx('user_campuses as uc')
        .join('campuses as c', 'c.id', 'uc.campus_id')
        .where({
          'uc.user_id': user.id, 'uc.is_active': true,
          'c.organization_id': user.organization_id, 'c.is_active': true
        })
        .select('uc.campus_id');
      return {
        id: user.id, orgId: user.organization_id, name: user.name, email: user.email,
        role: user.role, campusIds: memberships.map((m) => m.campus_id),
        activeCampusId: memberships[0]?.campus_id, isActive: Boolean(user.is_active)
      };
    });
  }
  async revokeRefreshToken(tokenHash) {
    await this.db('refresh_tokens').where({ token_hash: tokenHash }).update({ revoked_at: this.db.fn.now() });
  }
  async listStudents(campusId) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
      .orderBy('created_at', 'desc').limit(250);
    return rows.map(mapStudent);
  }
  async listSections(campusId, actor = null) {
    const rows = await this.db('sections as s')
      .leftJoin('grade_levels as g', 'g.id', 's.grade_level_id')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.campus_id': campusId })
      .where({ 'y.status': 'active' })
      .select('s.id', 's.campus_id', 's.name', 'g.name_en as grade_name')
      .orderBy('g.sort_order').orderBy('s.name');
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    const mapped = rows.map((row) => ({
      id: row.id, campusId: row.campus_id, name: row.name, gradeName: row.grade_name ?? ''
    })).filter((section) => accessible === null || accessible.has(section.id));
    return mapped;
  }
  async accessibleSectionIds(actor) {
    if (!['homeroom_teacher', 'subject_teacher'].includes(actor.role)) return null;
    const staff = await this.db('staff').where({
      campus_id: actor.activeCampusId, user_id: actor.sub
    }).whereNull('archived_at').first();
    if (!staff) return new Set();
    const [teaching, homeroom] = await Promise.all([
      this.db('teaching_assignments').where({
        campus_id: actor.activeCampusId, staff_id: staff.id, is_active: true
      }).select('section_id'),
      this.db('homeroom_assignments').where({
        campus_id: actor.activeCampusId, staff_id: staff.id
      }).select('section_id')
    ]);
    return new Set([...teaching, ...homeroom].map((item) => item.section_id));
  }
  async hasSection(campusId, sectionId) {
    return Boolean(await this.db('sections as s').join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.campus_id': campusId, 's.id': sectionId, 'y.status': 'active' }).first());
  }
  async hasStudentsInSection(campusId, sectionId, ids) {
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .where({
        'st.campus_id': campusId, 'e.section_id': sectionId,
        'e.status': 'active', 'y.status': 'active'
      })
      .whereIn('st.id', ids)
      .countDistinct({ total: 'st.id' }).first();
    return Number(rows.total) === ids.length;
  }
  async getAcademicYear(campusId) {
    const row = await this.db('academic_years').where({ campus_id: campusId, status: 'active' })
      .orderBy('start_date', 'desc').first();
    return row ? {
      id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
      startDate: String(row.start_date).slice(0, 10),
      endDate: String(row.end_date).slice(0, 10), status: row.status
    } : null;
  }
  async listAcademicYears(campusId) {
    const rows = await this.db('academic_years').where({ campus_id: campusId }).orderBy('start_date', 'desc');
    return rows.map(mapAcademicYear);
  }
  async createAcademicYear(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('academic_years').insert({
          id, campus_id: actor.activeCampusId, label_ec: data.labelEc,
          start_date: data.startDate, end_date: data.endDate, status: 'planned'
        });
        await trx('audit_log').insert(auditRow(actor, 'academic_year.created', 'academic_year', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Academic-year label already exists at this campus.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, ...data, status: 'planned' };
  }
  async activateAcademicYear(yearId, actor) {
    return this.db.transaction(async (trx) => {
      const campus = await trx('campuses').where({
        id: actor.activeCampusId, organization_id: actor.orgId
      }).forUpdate().first();
      if (!campus) return null;
      const year = await trx('academic_years').where({
        id: yearId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!year) return null;
      const previous = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).select('id', 'label_ec');
      const previousIds = previous.map((item) => item.id).filter((id) => id !== yearId);
      if (previousIds.length) {
        await trx('terms').whereIn('academic_year_id', previousIds).update({ is_current: false });
      }
      await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).update({ status: 'closed' });
      await trx('academic_years').where({ id: yearId, campus_id: actor.activeCampusId })
        .update({ status: 'active' });
      const updated = mapAcademicYear({ ...year, status: 'active' });
      await trx('audit_log').insert(auditRow(
        actor, 'academic_year.activated', 'academic_year', yearId,
        previous.map((item) => ({ id: item.id, labelEc: item.label_ec })), updated
      ));
      return updated;
    });
  }
  async listTerms(campusId) {
    const rows = await this.db('terms as t')
      .join('academic_years as y', 'y.id', 't.academic_year_id')
      .where({ 'y.campus_id': campusId })
      .select('t.id', 't.academic_year_id', 't.name', 't.start_date', 't.end_date', 't.is_current');
    return rows.map((row) => ({
      id: row.id, academicYearId: row.academic_year_id, name: row.name,
      startDate: String(row.start_date).slice(0, 10), endDate: String(row.end_date).slice(0, 10),
      isCurrent: Boolean(row.is_current)
    }));
  }
  async createTerm(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    if (!year) throw setupConflict('Create or activate an academic year before adding terms.');
    if (data.startDate < year.startDate || data.endDate > year.endDate) {
      const error = new Error('Term dates must be within the active academic year.');
      error.status = 400;
      error.code = 'TERM_OUTSIDE_ACADEMIC_YEAR';
      throw error;
    }
    const id = randomUUID();
    let isCurrent = false;
    try {
      await this.db.transaction(async (trx) => {
        const activeYear = await trx('academic_years').where({
          id: year.id, campus_id: actor.activeCampusId, status: 'active'
        }).forUpdate().first();
        if (!activeYear) throw setupConflict('The active academic year changed. Reload and try again.');
        const count = await trx('terms').where({ academic_year_id: year.id }).count({ total: '*' }).first();
        isCurrent = Number(count.total) === 0;
        await trx('terms').insert({
          id, academic_year_id: year.id, name: data.name, start_date: data.startDate,
          end_date: data.endDate, is_current: isCurrent
        });
        await trx('audit_log').insert(auditRow(actor, 'term.created', 'term', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Term name already exists in the active academic year.');
      throw error;
    }
    return { id, academicYearId: year.id, ...data, isCurrent };
  }
  async listGrades(campusId) {
    const rows = await this.db('grade_levels').where({ campus_id: campusId }).orderBy('sort_order');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code, nameEn: row.name_en,
      nameAm: row.name_am, band: row.band, sortOrder: row.sort_order
    }));
  }
  async createGrade(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('grade_levels').insert({
          id, campus_id: actor.activeCampusId, code: data.code, name_en: data.nameEn,
          name_am: data.nameAm, band: data.band, sort_order: data.sortOrder
        });
        await trx('audit_log').insert(auditRow(actor, 'grade_level.created', 'grade_level', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Grade code already exists at this campus.');
      throw error;
    }
    const grade = { id, campusId: actor.activeCampusId, ...data };
    return grade;
  }
  async listSubjects(campusId) {
    const rows = await this.db('subjects').where({ campus_id: campusId }).orderBy('name_en');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, code: row.code,
      nameEn: row.name_en, nameAm: row.name_am
    }));
  }
  async createSubject(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('subjects').insert({
          id, campus_id: actor.activeCampusId, code: data.code,
          name_en: data.nameEn, name_am: data.nameAm
        });
        await trx('audit_log').insert(auditRow(actor, 'subject.created', 'subject', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Subject code already exists at this campus.');
      throw error;
    }
    const subject = { id, campusId: actor.activeCampusId, ...data };
    return subject;
  }
  async createSection(data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      const grade = await trx('grade_levels').where({
        id: data.gradeLevelId, campus_id: actor.activeCampusId
      }).first();
      if (!year || !grade) throw campusScopeError('Grade or active academic year is not available at this campus.');
      try {
        await trx('sections').insert({
          id, campus_id: actor.activeCampusId, academic_year_id: year.id,
          grade_level_id: grade.id, name: data.name, capacity: data.capacity ?? null
        });
        await trx('audit_log').insert(auditRow(actor, 'section.created', 'section', id, null, data));
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Section name already exists in the active academic year.');
        throw error;
      }
      return {
        id, campusId: actor.activeCampusId, academicYearId: year.id, gradeLevelId: grade.id,
        gradeName: grade.name_en, name: data.name, capacity: data.capacity ?? null
      };
    });
  }
  async createStudent(data, actor) {
    const id = randomUUID();
    const placement = await this.db('sections as s')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({
        's.campus_id': actor.activeCampusId, 's.name': data.sectionName,
        'y.status': 'active'
      })
      .select('s.id as section_id', 's.academic_year_id')
      .first();
    if (!placement) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    try {
      await this.db.transaction(async (trx) => {
        await trx('students').insert({
          id, campus_id: actor.activeCampusId, student_no: data.studentNo,
          given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
          grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
          father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
          gender: data.gender, section_name: data.sectionName ?? null
        });
        await trx('enrolments').insert({
          id: randomUUID(), student_id: id, academic_year_id: placement.academic_year_id,
          section_id: placement.section_id, status: 'active', enrolled_on: new Date()
        });
        await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus.';
      }
      throw error;
    }
    return { id, ...data, campusId: actor.activeCampusId, status: 'enrolled' };
  }
  async hasStudents(campusId, ids) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereIn('id', ids).count({ total: '*' }).first();
    return Number(rows.total) === ids.length;
  }
  async hasStudentsInSections(campusId, sectionIds, ids) {
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .where({ 'st.campus_id': campusId, 'e.status': 'active' })
      .whereIn('e.section_id', sectionIds)
      .whereIn('st.id', ids)
      .countDistinct({ total: 'st.id' }).first();
    return Number(rows.total) === ids.length;
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return this.listStudents(actor.activeCampusId);
    if (accessible.size === 0) return [];
    const rows = await this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*').distinct().orderBy('st.created_at', 'desc').limit(250);
    return rows.map(mapStudent);
  }
  async listRoster(actor, sectionId) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !accessible.has(sectionId)) throw campusScopeError('Section is not accessible.');
    const section = await this.db('sections as s')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.id': sectionId, 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
      .first('s.id');
    if (!section) throw campusScopeError('Section is not accessible.');
    const rows = await this.db('enrolments as e')
      .join('students as st', 'st.id', 'e.student_id')
      .where({
        'st.campus_id': actor.activeCampusId, 'e.section_id': sectionId, 'e.status': 'active'
      }).whereNull('st.archived_at').select('st.*').orderBy('st.given_name_en').limit(500);
    return rows.map(mapStudent);
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return this.listStudents(actor.activeCampusId);
    if (accessible.size === 0) return [];
    const query = this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*').distinct().orderBy('st.created_at', 'desc').limit(250);
    return (await query).map(mapStudent);
  }
  async saveAttendance(data, actor) {
    const prior = await this.db('attendance_sessions').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    if (!await this.hasSection(actor.activeCampusId, data.sectionId)) {
      const error = new Error('Section is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessibleSections = await this.accessibleSectionIds(actor);
    if (accessibleSections && !accessibleSections.has(data.sectionId)) {
      throw campusScopeError('Teacher is not assigned to this section.');
    }
    if (!await this.hasStudentsInSection(actor.activeCampusId, data.sectionId, data.records.map((r) => r.studentId))) {
      const error = new Error('Attendance includes a student outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('attendance_sessions').insert({
          id, campus_id: actor.activeCampusId, section_id: data.sectionId,
          attendance_date: data.date, taken_by: actor.sub, client_uuid: data.clientUuid
        });
        for (const record of data.records) {
          await trx('attendance_records').insert({
            session_id: id, student_id: record.studentId, status: record.status
          });
        }
        await trx('audit_log').insert(auditRow(actor, 'attendance.recorded', 'attendance_session', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.db('attendance_sessions').where({
          campus_id: actor.activeCampusId, client_uuid: data.clientUuid
        }).first();
        if (concurrent) return { id: concurrent.id, duplicate: true };
      }
      throw error;
    }
    return { id, ...data };
  }
  async listAttendance(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible && accessible.size === 0) return [];
    const query = this.db('attendance_sessions').where({ campus_id: campusId });
    if (accessible) query.whereIn('section_id', [...accessible]);
    const rows = await query
      .orderBy('attendance_date', 'desc').limit(100);
    return rows.map((r) => ({ id: r.id, date: String(r.attendance_date).slice(0, 10), sectionId: r.section_id, clientUuid: r.client_uuid }));
  }
  async saveMark(data, actor) {
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [data.studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s section.');
    }
    const prior = await this.db('marks').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('marks').insert({
          id, campus_id: actor.activeCampusId, student_id: data.studentId,
          assessment_name: data.assessmentName, max_value: data.maxValue,
          value: data.value, entered_by: actor.sub, client_uuid: data.clientUuid
        });
        await trx('audit_log').insert(auditRow(actor, 'mark.created', 'mark', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        const concurrent = await this.db('marks').where({
          campus_id: actor.activeCampusId, client_uuid: data.clientUuid
        }).first();
        if (concurrent) return { id: concurrent.id, duplicate: true };
      }
      throw error;
    }
    return { id, ...data, state: 'draft' };
  }
  async listMarks(campusId, actor = null) {
    const accessible = actor ? await this.accessibleSectionIds(actor) : null;
    if (accessible && accessible.size === 0) return [];
    const query = this.db('marks').where({ campus_id: campusId });
    if (accessible) {
      query.whereIn('student_id', this.db('enrolments as e')
        .join('students as st', 'st.id', 'e.student_id')
        .whereIn('e.section_id', [...accessible])
        .where({ 'st.campus_id': campusId, 'e.status': 'active' })
        .select('e.student_id'));
    }
    const rows = await query.orderBy('created_at', 'desc').limit(250);
    return rows.map((r) => ({
      id: r.id, studentId: r.student_id, assessmentName: r.assessment_name,
      maxValue: Number(r.max_value), value: Number(r.value), state: r.state
    }));
  }
  async getDashboard(campusId) {
    const today = addisDate();
    const [students, attendance, marks, attendanceToday, recentStudents, sections, genderRows] = await Promise.all([
      this.db('students').where({ campus_id: campusId }).whereNull('archived_at').count({ total: '*' }).first(),
      this.db('attendance_sessions').where({ campus_id: campusId }).count({ total: '*' }).first(),
      this.db('marks').where({ campus_id: campusId }).count({ total: '*' }).first(),
      this.db('attendance_sessions').where({ campus_id: campusId, attendance_date: today }).count({ total: '*' }).first(),
      this.listStudents(campusId),
      this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
        .select('section_name').count({ total: '*' }).groupBy('section_name'),
      this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
        .select('gender').count({ total: '*' }).groupBy('gender')
    ]);
    const genderTotals = { female: 0, male: 0, other: 0 };
    for (const row of genderRows) genderTotals[row.gender] = Number(row.total);
    return {
      studentCount: Number(students.total), attendanceSessions: Number(attendance.total),
      marksRecorded: Number(marks.total), attendanceToday: Number(attendanceToday.total),
      recentStudents: recentStudents.slice(0, 5),
      sectionDistribution: sections.map((row) => ({ sectionName: row.section_name ?? 'Unassigned', count: Number(row.total) })),
      genderTotals, mode: this.mode
    };
  }
  async appendAudit(actor, action, entityType, entityId, before, after) {
    await this.db('audit_log').insert(auditRow(actor, action, entityType, entityId, before, after));
  }
  async getCampus(campusId) {
    const row = await this.db('campuses').where({ id: campusId }).first();
    return row ? {
      id: row.id, organizationId: row.organization_id, name: row.name,
      address: row.address ?? '', phone: row.phone ?? '', timezone: row.timezone
    } : null;
  }
  async updateCampus(data, actor) {
    const before = await this.getCampus(actor.activeCampusId);
    if (!before) return null;
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId, organization_id: actor.orgId }).update(data);
      await trx('audit_log').insert(auditRow(
        actor, 'school.profile_updated', 'campus', actor.activeCampusId, before, data
      ));
    });
    return this.getCampus(actor.activeCampusId);
  }
  async listDepartments(campusId) {
    const rows = await this.db('departments').where({ campus_id: campusId }).orderBy('name');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, name: row.name, description: row.description ?? ''
    }));
  }
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
  }
  async listStaff(actor) {
    const visibility = await this.staffVisibility(actor);
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
  }
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
  }
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
        await trx('staff').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'staff.created', 'staff', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Account is already linked to a staff profile.');
      throw error;
    }
    const department = data.departmentId ? await this.db('departments').where({ id: data.departmentId }).first() : null;
    return mapStaff(row, { departmentName: department?.name ?? '', teachingAssignmentCount: 0, homeroomCount: 0 });
  }
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
          }).first('s.id', 's.name');
        const subject = await trx('subjects').where({
          id: data.subjectId, campus_id: actor.activeCampusId
        }).first('id', 'name_en');
        if (!staff || !section || !subject) throw campusScopeError('Staff, section or subject is outside the active campus.');
        if (data.dayOfWeek != null) {
          const conflict = await trx('teaching_assignments')
            .where({ campus_id: actor.activeCampusId, day_of_week: data.dayOfWeek, period_number: data.periodNumber, is_active: true })
            .andWhere((builder) => builder.where('staff_id', staff.id).orWhere('section_id', section.id))
            .first();
          if (conflict) throw scheduleConflict('Teacher already has an assignment in this timetable period.');
        }
        const row = {
          id, campus_id: actor.activeCampusId, staff_id: staff.id, section_id: section.id,
          subject_id: subject.id, day_of_week: data.dayOfWeek ?? null,
          period_number: data.periodNumber ?? null, is_active: true
        };
        await trx('teaching_assignments').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'teaching_assignment.created', 'teaching_assignment', id, null, data));
        return {
          id, campusId: actor.activeCampusId, staffId: staff.id, sectionId: section.id,
          subjectId: subject.id, dayOfWeek: row.day_of_week, periodNumber: row.period_number,
          isActive: true, staffName: formatStaffName(mapStaff(staff)),
          sectionName: section.name, subjectName: subject.name_en
        };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('This teacher is already assigned in that section, subject or timetable period.');
      throw error;
    }
  }
  async listTeachingAssignments(actor) {
    const visibility = await this.staffVisibility(actor);
    if (visibility.empty) return [];
    const query = this.db('teaching_assignments as ta')
      .join('staff as st', 'st.id', 'ta.staff_id')
      .join('sections as sc', 'sc.id', 'ta.section_id')
      .join('subjects as su', 'su.id', 'ta.subject_id')
      .where({ 'ta.campus_id': actor.activeCampusId, 'ta.is_active': true })
      .whereNull('st.archived_at');
    if (visibility.staffId) query.where('st.id', visibility.staffId);
    if (visibility.departmentId) query.where('st.department_id', visibility.departmentId);
    const rows = await query.select('ta.*', 'sc.name as section_name', 'su.name_en as subject_name',
      'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en',
      'st.given_name_am', 'st.father_name_am', 'st.grandfather_name_am');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, staffId: row.staff_id,
      sectionId: row.section_id, subjectId: row.subject_id, dayOfWeek: row.day_of_week,
      periodNumber: row.period_number, isActive: Boolean(row.is_active),
      staffName: formatStaffName(mapStaff(row)), sectionName: row.section_name, subjectName: row.subject_name
    }));
  }
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
  }
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
  }
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
  }
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
  }
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
  }
  async findLeaveRequest(id, campusId, trx = this.db) {
    const row = await trx('leave_requests as lr').join('staff as st', 'st.id', 'lr.staff_id')
      .where({ 'lr.id': id, 'lr.campus_id': campusId })
      .first('lr.*', 'st.given_name_en', 'st.father_name_en', 'st.grandfather_name_en');
    return row ? mapLeaveRequest(row) : null;
  }
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
  }
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
  async createStaffMessage(data, actor) {
    if (data.departmentId && !await this.db('departments').where({
      id: data.departmentId, campus_id: actor.activeCampusId
    }).first()) throw campusScopeError('Department is outside the active campus.');
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, department_id: data.departmentId ?? null,
      created_by: actor.sub, message_type: data.type, title: data.title, body: data.body
    };
    await this.db.transaction(async (trx) => {
      await trx('staff_messages').insert(row);
      await trx('audit_log').insert(auditRow(actor, `staff_message.${data.type}_created`, 'staff_message', id, null, data));
    });
    return {
      id, campusId: actor.activeCampusId, departmentId: row.department_id,
      createdBy: actor.sub, type: data.type, title: data.title, body: data.body
    };
  }
  async listStaffMessages(actor) {
    const own = await this.db('staff').where({
      campus_id: actor.activeCampusId, user_id: actor.sub
    }).whereNull('archived_at').first();
    const query = this.db('staff_messages').where({ campus_id: actor.activeCampusId });
    if (own?.department_id) query.where((builder) =>
      builder.whereNull('department_id').orWhere('department_id', own.department_id));
    else if (!['owner_director', 'group_executive', 'principal', 'academic_head', 'hr_admin', 'system_admin'].includes(actor.role)) {
      query.whereNull('department_id');
    }
    const rows = await query.orderBy('created_at', 'desc').limit(200);
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, departmentId: row.department_id,
      createdBy: row.created_by, type: row.message_type, title: row.title, body: row.body,
      createdAt: row.created_at
    }));
  }
  async getAdmissionsDashboard(campusId) {
    const statusRows = await this.db('admissions').where({ campus_id: campusId })
      .groupBy('status').select('status').count({ total: '*' });
    const byStatus = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.total)]));
    const gradeRows = await this.db('admissions as a')
      .join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .where({ 'a.campus_id': campusId })
      .groupBy('g.id', 'g.name_en').select('g.name_en as grade')
      .count({ total: '*' })
      .count({ enrolled: this.db.raw('CASE WHEN a.status = ? THEN 1 END', ['enrolled']) });
    return {
      total: statusRows.reduce((sum, row) => sum + Number(row.total), 0),
      byStatus, byGrade: gradeRows.map((row) => ({ grade: row.grade, total: Number(row.total), enrolled: Number(row.enrolled) }))
    };
  }
  async listAdmissions(campusId, { status = null, query = '' } = {}) {
    const builder = this.db('admissions as a').join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .leftJoin('students as s', 's.id', 'a.student_id')
      .where({ 'a.campus_id': campusId })
      .select('a.*', 'g.name_en as grade_name', 's.student_no');
    if (status) builder.where('a.status', status);
    if (query) builder.where((where) => where
      .where('a.given_name_en', 'like', `%${query}%`)
      .orWhere('a.father_name_en', 'like', `%${query}%`)
      .orWhere('a.grandfather_name_en', 'like', `%${query}%`)
      .orWhere('a.given_name_am', 'like', `%${query}%`)
      .orWhere('a.father_name_am', 'like', `%${query}%`)
      .orWhere('a.grandfather_name_am', 'like', `%${query}%`)
      .orWhere('a.guardian_name', 'like', `%${query}%`)
      .orWhere('a.guardian_phone', 'like', `%${query}%`));
    const rows = await builder.orderBy('a.created_at', 'desc').limit(500);
    return Promise.all(rows.map((row) => this.enrichAdmission(row)));
  }
  async getAdmission(campusId, admissionId) {
    const row = await this.db('admissions as a')
      .join('grade_levels as g', 'g.id', 'a.grade_level_id')
      .leftJoin('students as s', 's.id', 'a.student_id')
      .where({ 'a.id': admissionId, 'a.campus_id': campusId })
      .select('a.*', 'g.name_en as grade_name', 's.student_no').first();
    return row ? this.enrichAdmission(row) : null;
  }
  async enrichAdmission(row) {
    const admission = mapAdmission(row);
    const documents = await this.listAdmissionDocuments(row.campus_id, row.id);
    return {
      ...admission, documents,
      documentChecklist: admission.requiredDocuments.map((type) => ({
        type, complete: documents.some((document) => document.documentType === type)
      }))
    };
  }
  async findAdmissionDuplicates(campusId, { name = '', dateOfBirth = '', guardianPhone = '' }) {
    const needle = name.trim();
    const duplicateWhere = (builder) => {
      let hasWhere = false;
      if (guardianPhone) {
        builder.where('guardian_phone', guardianPhone);
        hasWhere = true;
      }
      if (needle && dateOfBirth) {
        const nameMatch = (condition) => condition
          .whereRaw('LOWER(CONCAT(given_name_en, " ", father_name_en, " ", grandfather_name_en)) = LOWER(?)', [needle])
          .orWhereRaw('LOWER(CONCAT(given_name_am, " ", father_name_am, " ", grandfather_name_am)) = LOWER(?)', [needle]);
        builder[hasWhere ? 'orWhere' : 'where']((condition) =>
          condition.where('date_of_birth', dateOfBirth).andWhere(nameMatch));
      }
    };
    const [admissions, students] = await Promise.all([
      this.db('admissions').where({ campus_id: campusId }).andWhere(duplicateWhere)
        .select('id', 'status', 'given_name_en', 'father_name_en', 'grandfather_name_en', 'guardian_phone'),
      this.db('students').where({ campus_id: campusId }).andWhere(duplicateWhere)
        .select('id', 'status', 'given_name_en', 'father_name_en', 'grandfather_name_en', 'guardian_phone')
    ]);
    return [
      ...admissions.map((row) => ({ id: row.id, type: 'admission', status: row.status, name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`, guardianPhone: row.guardian_phone })),
      ...students.map((row) => ({ id: row.id, type: 'student', status: row.status, name: `${row.given_name_en} ${row.father_name_en} ${row.grandfather_name_en}`, guardianPhone: row.guardian_phone ?? '' }))
    ];
  }
  async createAdmission(data, actor) {
    const year = await this.getAcademicYear(actor.activeCampusId);
    const grade = await this.db('grade_levels').where({
      id: data.gradeLevelId, campus_id: actor.activeCampusId
    }).first();
    if (!year || !grade) throw campusScopeError('An active academic year and campus grade are required.');
    const id = randomUUID();
    const admission = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      academic_year_id: year.id, given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
      grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
      father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
      gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
      guardian_name: data.guardianName, guardian_phone: data.guardianPhone,
      guardian_email: data.guardianEmail ?? null, grade_level_id: data.gradeLevelId,
      previous_school: data.previousSchool ?? null, status: 'enquiry',
      required_documents: JSON.stringify(['birth_certificate', 'previous_school_report', 'guardian_id']),
      created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('admissions').insert(admission);
      await trx('audit_log').insert(auditRow(actor, 'admission.created', 'admission', id, null, data));
    });
    return this.getAdmission(actor.activeCampusId, id);
  }
  async setStudentIdPattern(pattern, actor) {
    const campus = await this.db('campuses').where({ id: actor.activeCampusId }).first();
    if (!campus) throw campusScopeError('Campus is not available.');
    await this.db.transaction(async (trx) => {
      await trx('campuses').where({ id: actor.activeCampusId }).update({ student_id_pattern: pattern });
      await trx('audit_log').insert(auditRow(actor, 'admission.student_id_pattern_updated', 'campus', actor.activeCampusId, { pattern: campus.student_id_pattern }, { pattern }));
    });
    return { pattern };
  }
  async scheduleAdmissionInterview(admissionId, data, actor) {
    const found = await this.db.transaction(async (trx) => {
      const row = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      if (!['application', 'interview'].includes(row.status)) throw setupConflict('Only applicants may be scheduled for an interview.');
      const before = { status: row.status, interviewAt: row.interview_at, interviewResult: row.interview_result };
      await trx('admissions').where({ id: admissionId }).update({
        status: 'interview', interview_at: toMysqlDateTime(data.interviewAt), interview_result: data.interviewResult
      });
      await trx('audit_log').insert(auditRow(actor, 'admission.interview_scheduled', 'admission', admissionId, before, data));
      return true;
    });
    return found ? this.getAdmission(actor.activeCampusId, admissionId) : null;
  }
  async updateAdmissionStatus(admissionId, data, actor) {
    const found = await this.db.transaction(async (trx) => {
      const row = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!row) return null;
      const allowed = {
        enquiry: ['application', 'rejected'], application: ['accepted', 'waitlisted', 'rejected', 'interview'],
        interview: ['accepted', 'waitlisted', 'rejected'], waitlisted: ['accepted', 'rejected']
      };
      if (!allowed[row.status]?.includes(data.status)) throw setupConflict(`Cannot move an admission from ${row.status} to ${data.status}.`);
      await trx('admissions').where({ id: admissionId }).update({
        status: data.status, decision_note: data.decisionNote
      });
      await trx('audit_log').insert(auditRow(actor, `admission.${data.status}`, 'admission', admissionId, { status: row.status }, data));
      return true;
    });
    return found ? this.getAdmission(actor.activeCampusId, admissionId) : null;
  }
  async storeAdmissionDocument(admissionId, documentType, originalName, mimeType, content, actor) {
    const admission = await this.db('admissions').where({
      id: admissionId, campus_id: actor.activeCampusId
    }).first();
    if (!admission) throw campusScopeError('Admission is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content)) throw invalidDocument('The document content does not match its declared file type.');
    const id = randomUUID();
    const storageKey = randomUUID();
    const document = {
      id, admission_id: admissionId, document_type: documentType,
      original_name: safeFilename(originalName),
      mime_type: mimeType, size_bytes: content.length, storage_key: storageKey,
      sha256: createHash('sha256').update(content).digest('hex'), uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, storageKey);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await trx('admission_documents').insert(document);
        await trx('audit_log').insert(auditRow(actor, 'admission.document_uploaded', 'admission_document', id, null, {
          admissionId, documentType, sizeBytes: content.length, sha256: document.sha256
        }));
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapAdmissionDocument(document);
  }
  async listAdmissionDocuments(campusId, admissionId) {
    const admission = await this.db('admissions').where({ id: admissionId, campus_id: campusId }).first();
    if (!admission) return [];
    const rows = await this.db('admission_documents').where({ admission_id: admissionId }).orderBy('created_at', 'desc');
    return rows.map(mapAdmissionDocument);
  }
  async getAdmissionDocument(campusId, admissionId, documentId) {
    const rows = await this.db('admission_documents as d')
      .join('admissions as a', 'a.id', 'd.admission_id')
      .where({ 'a.campus_id': campusId, 'a.id': admissionId, 'd.id': documentId })
      .select('d.*').first();
    if (!rows) return null;
    const filePath = path.join(this.privateDocumentsDir, path.basename(rows.storage_key));
    return { document: mapAdmissionDocument(rows), content: await readFile(filePath) };
  }
  async enrolAdmission(admissionId, { sectionId, siblingStudentId = null }, actor) {
    const result = await this.db.transaction(async (trx) => {
      const admission = await trx('admissions').where({
        id: admissionId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!admission) throw campusScopeError('Admission is outside the active campus.');
      if (admission.status !== 'accepted') throw setupConflict('Only accepted applicants can be enrolled.');
      const required = Array.isArray(admission.required_documents)
        ? admission.required_documents : JSON.parse(admission.required_documents);
      const uploaded = await trx('admission_documents').where({ admission_id: admissionId }).pluck('document_type');
      if (required.some((type) => !uploaded.includes(type))) throw setupConflict('All required documents must be uploaded before enrolment.');
      const section = await trx('sections as s').join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({
          's.id': sectionId, 's.campus_id': actor.activeCampusId,
          's.grade_level_id': admission.grade_level_id,
          's.academic_year_id': admission.academic_year_id, 'y.status': 'active'
        }).forUpdate().select('s.*').first();
      if (!section) throw campusScopeError('Select an active section for the applicant’s grade and academic year at this campus.');
      if (section.capacity != null) {
        const count = await trx('enrolments').where({
          section_id: sectionId, academic_year_id: admission.academic_year_id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(count.total) >= Number(section.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      if (siblingStudentId) {
        const sibling = await trx('students').where({
          id: siblingStudentId, campus_id: actor.activeCampusId, status: 'enrolled'
        }).first();
        if (!sibling) throw campusScopeError('Sibling student is not enrolled at this campus.');
      }
      const campus = await trx('campuses').where({ id: actor.activeCampusId }).first();
      await trx('admission_counters').insert({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id, last_value: 0
      }).onConflict(['campus_id', 'academic_year_id']).ignore();
      const counter = await trx('admission_counters').where({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id
      }).forUpdate().first();
      const sequence = Number(counter.last_value) + 1;
      const year = await trx('academic_years').where({ id: admission.academic_year_id }).first();
      const studentNo = formatStudentNo(campus.student_id_pattern, campus.name, year.label_ec, sequence);
      await trx('admission_counters').where({
        campus_id: actor.activeCampusId, academic_year_id: admission.academic_year_id
      }).update({ last_value: sequence });
      const studentId = randomUUID();
      await trx('students').insert({
        id: studentId, campus_id: actor.activeCampusId, student_no: studentNo,
        given_name_am: admission.given_name_am, father_name_am: admission.father_name_am,
        grandfather_name_am: admission.grandfather_name_am, given_name_en: admission.given_name_en,
        father_name_en: admission.father_name_en, grandfather_name_en: admission.grandfather_name_en,
        gender: admission.gender, date_of_birth: admission.date_of_birth,
        section_name: section.name, previous_school: admission.previous_school,
        guardian_phone: admission.guardian_phone, status: 'enrolled'
      });
      await trx('enrolments').insert({
        id: randomUUID(), student_id: studentId, academic_year_id: admission.academic_year_id,
        section_id: sectionId, status: 'active', enrolled_on: addisDate()
      });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: 'enrolled', reason: `Admission ${admissionId}`, recorded_by: actor.sub
      });
      await trx('admissions').where({ id: admissionId }).update({
        status: 'enrolled', section_id: sectionId, student_id: studentId,
        sibling_student_id: siblingStudentId
      });
      if (siblingStudentId) {
        await trx('student_siblings').insert([
          { student_id: studentId, sibling_student_id: siblingStudentId, campus_id: actor.activeCampusId },
          { student_id: siblingStudentId, sibling_student_id: studentId, campus_id: actor.activeCampusId }
        ]).onConflict().ignore();
      }
      await trx('audit_log').insert(auditRow(actor, 'admission.enrolled', 'student', studentId, {
        admissionId, status: 'accepted'
      }, { studentNo, sectionId, siblingStudentId }));
      return { studentId, studentNo };
    });
    const studentRow = await this.db('students').where({ id: result.studentId }).first();
    return { student: mapStudent(studentRow), admission: await this.getAdmission(actor.activeCampusId, admissionId) };
  }
  async changeStudentStatus(studentId, status, reason, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!student) return null;
      if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can be withdrawn or transferred.');
      const before = { status: student.status, sectionName: student.section_name };
      await trx('students').where({ id: studentId }).update({ status });
      await trx('admissions').where({ student_id: studentId }).update({ status });
      await trx('enrolments').where({
        student_id: studentId, status: 'active'
      }).update({ status: 'withdrawn', left_on: addisDate(), outcome: status });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status, reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, `student.${status}`, 'student', studentId, before, { status, reason }));
      return mapStudent({ ...student, status });
    });
  }
  async readmitStudent(studentId, { sectionId, reason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!student) return null;
      if (student.status !== 'withdrawn') throw setupConflict('Only a withdrawn student can be readmitted.');
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      const section = year && await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id
      }).forUpdate().first();
      if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
      if (section.capacity != null) {
        const count = await trx('enrolments').where({
          section_id: sectionId, academic_year_id: year.id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(count.total) >= Number(section.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      const current = await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id
      }).first();
      if (current) {
        await trx('enrolments').where({ id: current.id }).update({
          section_id: sectionId, status: 'active', enrolled_on: addisDate(), left_on: null, outcome: null
        });
      } else {
        await trx('enrolments').insert({
          id: randomUUID(), student_id: studentId, academic_year_id: year.id,
          section_id: sectionId, status: 'active', enrolled_on: addisDate()
        });
      }
      const before = { status: student.status, sectionName: student.section_name };
      await trx('students').where({ id: studentId }).update({ status: 'enrolled', section_name: section.name });
      await trx('admissions').where({ student_id: studentId }).update({ status: 'enrolled' });
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: 'enrolled', reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.readmitted', 'student', studentId, before, {
        status: 'enrolled', sectionId, reason
      }));
      return mapStudent({ ...student, status: 'enrolled', section_name: section.name });
    });
  }
  async transferStudentOut(studentId, reason, actor) {
    return this.changeStudentStatus(studentId, 'transferred_out', reason, actor);
  }
  async getStudentTransferRecord(campusId, studentId) {
    const [student, history, campus] = await Promise.all([
      this.db('students').where({ id: studentId, campus_id: campusId }).first(),
      this.db('student_status_history').where({
        student_id: studentId, campus_id: campusId, status: 'transferred_out'
      }).orderBy('created_at', 'desc').first(),
      this.db('campuses').where({ id: campusId }).first()
    ]);
    return student && history && campus ? {
      student: mapStudent(student),
      history: { status: history.status, reason: history.reason, createdAt: history.created_at },
      campus: { id: campus.id, name: campus.name, address: campus.address }
    } : null;
  }
  async close() { await this.db.destroy(); }
}

function mapStudent(row) {
  return {
    id: row.id, campusId: row.campus_id, studentNo: row.student_no,
    givenNameAm: row.given_name_am, fatherNameAm: row.father_name_am,
    grandfatherNameAm: row.grandfather_name_am, givenNameEn: row.given_name_en,
    fatherNameEn: row.father_name_en, grandfatherNameEn: row.grandfather_name_en,
    gender: row.gender, sectionName: row.section_name ?? row.sectionName ?? '', status: row.status,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? null,
    previousSchool: row.previous_school ?? row.previousSchool ?? null,
    guardianPhone: row.guardian_phone ?? row.guardianPhone ?? null
  };
}

function mapAcademicYear(row) {
  return {
    id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10), status: row.status
  };
}

function formatStudentNo(pattern, campusName, yearLabel, sequence) {
  const campusCode = String(campusName ?? 'CAMPUS').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'CAMPUS';
  const yearCode = String(yearLabel ?? '').replace(/\D/g, '').slice(0, 4) || 'YEAR';
  return String(pattern ?? '{CAMPUS}-{YEAR}-{SEQ}')
    .replaceAll('{CAMPUS}', campusCode)
    .replaceAll('{YEAR}', yearCode)
    .replaceAll('{SEQ}', String(sequence).padStart(5, '0'));
}

function toMysqlDateTime(value) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function fromMysqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const iso = String(value).replace(' ', 'T');
  return iso.endsWith('Z') ? iso : `${iso}Z`;
}

function mapAdmission(row) {
  const requiredDocuments = Array.isArray(row.required_documents ?? row.requiredDocuments)
    ? (row.required_documents ?? row.requiredDocuments)
    : JSON.parse(row.required_documents ?? row.requiredDocuments ?? '[]');
  return {
    id: row.id, organizationId: row.organization_id ?? row.organizationId,
    campusId: row.campus_id ?? row.campusId,
    academicYearId: row.academic_year_id ?? row.academicYearId,
    givenNameAm: row.given_name_am ?? row.givenNameAm,
    fatherNameAm: row.father_name_am ?? row.fatherNameAm,
    grandfatherNameAm: row.grandfather_name_am ?? row.grandfatherNameAm,
    givenNameEn: row.given_name_en ?? row.givenNameEn,
    fatherNameEn: row.father_name_en ?? row.fatherNameEn,
    grandfatherNameEn: row.grandfather_name_en ?? row.grandfatherNameEn,
    gender: row.gender,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? null,
    guardianName: row.guardian_name ?? row.guardianName,
    guardianPhone: row.guardian_phone ?? row.guardianPhone,
    guardianEmail: row.guardian_email ?? row.guardianEmail ?? null,
    gradeLevelId: row.grade_level_id ?? row.gradeLevelId,
    gradeName: row.grade_name ?? row.gradeName ?? '',
    previousSchool: row.previous_school ?? row.previousSchool ?? null,
    status: row.status, requiredDocuments,
    interviewAt: fromMysqlDateTime(row.interview_at ?? row.interviewAt),
    interviewResult: row.interview_result ?? row.interviewResult ?? null,
    decisionNote: row.decision_note ?? row.decisionNote ?? '',
    sectionId: row.section_id ?? row.sectionId ?? null,
    studentId: row.student_id ?? row.studentId ?? null,
    siblingStudentId: row.sibling_student_id ?? row.siblingStudentId ?? null,
    studentNo: row.student_no ?? row.studentNo ?? null,
    createdAt: row.created_at ?? row.createdAt
  };
}

function mapAdmissionDocument(row) {
  return {
    id: row.id, admissionId: row.admission_id ?? row.admissionId,
    documentType: row.document_type ?? row.documentType,
    originalName: row.original_name ?? row.originalName,
    mimeType: row.mime_type ?? row.mimeType,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sha256: row.sha256, createdAt: row.created_at ?? row.createdAt
  };
}

function mapStaff(row, extra = {}) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    userId: row.user_id ?? row.userId ?? null,
    departmentId: row.department_id ?? row.departmentId ?? null,
    givenNameEn: row.given_name_en ?? row.givenNameEn,
    fatherNameEn: row.father_name_en ?? row.fatherNameEn,
    grandfatherNameEn: row.grandfather_name_en ?? row.grandfatherNameEn,
    givenNameAm: row.given_name_am ?? row.givenNameAm,
    fatherNameAm: row.father_name_am ?? row.fatherNameAm,
    grandfatherNameAm: row.grandfather_name_am ?? row.grandfatherNameAm,
    jobTitle: row.job_title ?? row.jobTitle,
    qualification: row.qualification ?? '',
    employmentStatus: row.employment_status ?? row.employmentStatus,
    hiredOn: row.hired_on ?? row.hiredOn ?? null,
    name: formatStaffName(row),
    ...extra
  };
}

function formatStaffName(staff) {
  return staff ? [staff.given_name_en ?? staff.givenNameEn, staff.father_name_en ?? staff.fatherNameEn,
    staff.grandfather_name_en ?? staff.grandfatherNameEn].filter(Boolean).join(' ') : '';
}

function mapStaffAttendance(row) {
  return {
    id: row.id, staffId: row.staff_id ?? row.staffId,
    date: String(row.attendance_date ?? row.date).slice(0, 10),
    status: row.status, clockIn: row.clock_in ?? row.clockIn ?? null,
    clockOut: row.clock_out ?? row.clockOut ?? null
  };
}

function mapLeaveRequest(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    staffId: row.staff_id ?? row.staffId,
    startDate: String(row.start_date ?? row.startDate).slice(0, 10),
    endDate: String(row.end_date ?? row.endDate).slice(0, 10),
    reason: row.reason, status: row.status,
    reviewedBy: row.reviewed_by ?? row.reviewedBy ?? null,
    reviewNote: row.review_note ?? row.reviewNote ?? '',
    reviewedAt: row.reviewed_at ?? row.reviewedAt ?? null,
    staffName: row.staffName ?? formatStaffName(row)
  };
}

function setupConflict(message) {
  const error = new Error(message);
  error.code = 'SETUP_CONFLICT';
  return error;
}

function scheduleConflict(message) {
  const error = new Error(message);
  error.code = 'SCHEDULE_CONFLICT';
  return error;
}

function invalidDocument(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'INVALID_DOCUMENT';
  return error;
}

function isValidDocumentContent(mimeType, content) {
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/png') return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  return false;
}

function safeFilename(filename) {
  return String(filename).split(/[\\/]/).pop().replace(/[\r\n"]/g, '_').slice(0, 180) || 'admission-document';
}

function campusScopeError(message) {
  const error = new Error(message);
  error.code = 'CAMPUS_SCOPE_VIOLATION';
  return error;
}

function auditRow(actor, action, entityType, entityId, before, after) {
  return {
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    actor_id: actor.sub, action, entity_type: entityType, entity_id: entityId,
    before_json: before ? JSON.stringify(before) : null,
    after_json: after ? JSON.stringify(after) : null
  };
}

export async function createRepository(config) {
  if (config.STORAGE_MODE === 'mysql') {
    const db = knexFactory({
      client: 'mysql2',
      connection: {
        host: config.DB_HOST, port: config.DB_PORT, user: config.DB_USER,
        password: config.DB_PASSWORD, database: config.DB_NAME, charset: 'utf8mb4',
        dateStrings: true
      },
      pool: { min: 0, max: 10 }
    });
    await db.raw('SELECT 1');
    return new MysqlRepository(db, config.PRIVATE_DOCUMENTS_DIR ?? '.private/admissions');
  }
  const userId = '10000000-0000-4000-8000-000000000001';
  const orgId = '20000000-0000-4000-8000-000000000001';
  const campusId = '30000000-0000-4000-8000-000000000001';
  const passwordHash = await bcrypt.hash(config.DEMO_LOGIN_PASSWORD, 12);
  const repo = new MemoryRepository({
    users: [{
      id: userId, orgId, name: 'SIMS Demo Administrator',
      email: config.DEMO_LOGIN_EMAIL, phone: null, passwordHash,
      role: 'owner_director', campusIds: [campusId], activeCampusId: campusId, isActive: true
    }],
    campuses: [{
      id: campusId, organizationId: orgId, name: 'Addis Learning Campus',
      address: 'Addis Ababa, Ethiopia', phone: '', timezone: 'Africa/Addis_Ababa'
    }],
    sections: [{
      id: '70000000-0000-4000-8000-000000000001', campusId,
      name: 'Grade 7A', gradeName: 'Grade 7',
      gradeLevelId: '60000000-0000-4000-8000-000000000001', isActive: true
    }],
    gradeLevels: [{
      id: '60000000-0000-4000-8000-000000000001', campusId, code: 'G7',
      nameEn: 'Grade 7', nameAm: '7ኛ ክፍል', band: 'primary', sortOrder: 7
    }],
    subjects: [{
      id: '61000000-0000-4000-8000-000000000001', campusId,
      code: 'MATH', nameEn: 'Mathematics', nameAm: 'ሂሳብ'
    }],
    academicYears: [{
      id: '50000000-0000-4000-8000-000000000001', campusId,
      labelEc: '2019 E.C.', startDate: '2026-09-11', endDate: '2027-09-10', status: 'active'
    }]
  });
  repo.students = [
    { id: '40000000-0000-4000-8000-000000000001', campusId, studentNo: 'SIMS-001', givenNameAm: 'ሳራ', fatherNameAm: 'አበበ', grandfatherNameAm: 'ተስፋዬ', givenNameEn: 'Sara', fatherNameEn: 'Abebe', grandfatherNameEn: 'Tesfaye', gender: 'female', sectionName: 'Grade 7A', status: 'enrolled', createdAt: now() },
    { id: '40000000-0000-4000-8000-000000000002', campusId, studentNo: 'SIMS-002', givenNameAm: 'ዳዊት', fatherNameAm: 'ከበደ', grandfatherNameAm: 'ገብረ', givenNameEn: 'Dawit', fatherNameEn: 'Kebede', grandfatherNameEn: 'Ghere', gender: 'male', sectionName: 'Grade 7A', status: 'enrolled', createdAt: now() },
    { id: '40000000-0000-4000-8000-000000000003', campusId, studentNo: 'SIMS-003', givenNameAm: 'ሚካኤል', fatherNameAm: 'ሀይሉ', grandfatherNameAm: 'ደሳለኝ', givenNameEn: 'Mikael', fatherNameEn: 'Hailu', grandfatherNameEn: 'Desalegn', gender: 'male', sectionName: 'Grade 7A', status: 'enrolled', createdAt: now() }
  ];
  return repo;
}
