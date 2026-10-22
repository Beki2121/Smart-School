import bcrypt from 'bcrypt';
import knexFactory from 'knex';
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const addisDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

export class MemoryRepository {
  constructor({ users, campuses, sections, academicYears, gradeLevels = [], subjects = [] }) {
    this.users = users;
    this.campuses = campuses;
    this.sections = sections;
    this.academicYears = academicYears;
    this.gradeLevels = gradeLevels;
    this.subjects = subjects;
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
  async listSections(campusId) {
    return this.sections.filter((section) => section.campusId === campusId && section.isActive);
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
  async listAttendance(campusId) {
    return this.attendance.filter((item) => item.campusId === campusId);
  }
  async saveMark(data, actor) {
    const existing = this.marks.find((item) =>
      item.campusId === actor.activeCampusId && item.clientUuid === data.clientUuid);
    if (existing) return { ...existing, duplicate: true };
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    const mark = {
      id: randomUUID(), campusId: actor.activeCampusId, ...data, state: 'draft',
      enteredBy: actor.sub, createdAt: now()
    };
    this.marks.unshift(mark);
    await this.appendAudit(actor, 'mark.created', 'mark', mark.id, null, mark);
    return mark;
  }
  async listMarks(campusId) { return this.marks.filter((item) => item.campusId === campusId); }
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
  async close() {}
}

export class MysqlRepository {
  constructor(knex) {
    this.db = knex;
    this.mode = 'mysql';
    this.loginFailures = new Map();
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
  async listSections(campusId) {
    const rows = await this.db('sections as s')
      .leftJoin('grade_levels as g', 'g.id', 's.grade_level_id')
      .join('academic_years as y', 'y.id', 's.academic_year_id')
      .where({ 's.campus_id': campusId })
      .where({ 'y.status': 'active' })
      .select('s.id', 's.campus_id', 's.name', 'g.name_en as grade_name')
      .orderBy('g.sort_order').orderBy('s.name');
    return rows.map((row) => ({
      id: row.id, campusId: row.campus_id, name: row.name, gradeName: row.grade_name ?? ''
    }));
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
  async listAttendance(campusId) {
    const rows = await this.db('attendance_sessions').where({ campus_id: campusId })
      .orderBy('attendance_date', 'desc').limit(100);
    return rows.map((r) => ({ id: r.id, date: String(r.attendance_date).slice(0, 10), sectionId: r.section_id, clientUuid: r.client_uuid }));
  }
  async saveMark(data, actor) {
    const prior = await this.db('marks').where({
      campus_id: actor.activeCampusId, client_uuid: data.clientUuid
    }).first();
    if (prior) return { id: prior.id, duplicate: true };
    if (!await this.hasStudents(actor.activeCampusId, [data.studentId])) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
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
  async listMarks(campusId) {
    const rows = await this.db('marks').where({ campus_id: campusId }).orderBy('created_at', 'desc').limit(250);
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
  async close() { await this.db.destroy(); }
}

function mapStudent(row) {
  return {
    id: row.id, campusId: row.campus_id, studentNo: row.student_no,
    givenNameAm: row.given_name_am, fatherNameAm: row.father_name_am,
    grandfatherNameAm: row.grandfather_name_am, givenNameEn: row.given_name_en,
    fatherNameEn: row.father_name_en, grandfatherNameEn: row.grandfather_name_en,
    gender: row.gender, sectionName: row.section_name ?? '', status: row.status
  };
}

function mapAcademicYear(row) {
  return {
    id: row.id, campusId: row.campus_id, labelEc: row.label_ec,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10), status: row.status
  };
}

function setupConflict(message) {
  const error = new Error(message);
  error.code = 'SETUP_CONFLICT';
  return error;
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
    return new MysqlRepository(db);
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
