import knexFactory from 'knex';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  decryptSensitiveValue, encryptSensitiveValue, hashSensitiveIdentifier
} from './secure-fields.js';
import { memoryCommunicationsBundle } from './repositories/memory/communications.repository.js';
import { mysqlCommunicationsBundle } from './repositories/mysql/communications.repository.js';
import { composeRepositoryBundles } from './repositories/compose-bundles.js';
import { memoryStaffBundle } from './repositories/memory/staff.repository.js';
import { mysqlStaffBundle } from './repositories/mysql/staff.repository.js';
import { memoryFeesBundle } from './repositories/memory/fees.repository.js';
import { mysqlFeesBundle } from './repositories/mysql/fees.repository.js';
import { memoryAttendanceBundle } from './repositories/memory/attendance.repository.js';
import { mysqlAttendanceBundle } from './repositories/mysql/attendance.repository.js';
import { memoryMarksBundle } from './repositories/memory/marks.repository.js';
import { mysqlMarksBundle } from './repositories/mysql/marks.repository.js';
import { memoryTimetableBundle } from './repositories/memory/timetable.repository.js';
import { mysqlTimetableBundle } from './repositories/mysql/timetable.repository.js';
import { memoryPlatformBundle } from './repositories/memory/platform.repository.js';
import { mysqlPlatformBundle } from './repositories/mysql/platform.repository.js';
import { memoryAccountsBundle } from './repositories/memory/accounts.repository.js';
import { mysqlAccountsBundle } from './repositories/mysql/accounts.repository.js';
import { memoryPortalBundle } from './repositories/memory/portal.repository.js';
import { mysqlPortalBundle } from './repositories/mysql/portal.repository.js';
import { memoryAcademicBundle } from './repositories/memory/academic.repository.js';
import { memoryStudentsBundle } from './repositories/memory/students.repository.js';
import { mysqlAcademicBundle } from './repositories/mysql/academic.repository.js';
import { mysqlStudentsBundle } from './repositories/mysql/students.repository.js';
import {
  attendanceCorrectionConflict, attendanceCorrectionWindowOpen, buildAttendanceSummary
} from './repositories/attendance.mappers.js';
import { generateStudentCredentials, mapStudent, studentName } from './repositories/students.mappers.js';
import { invalidDocument, isValidDocumentContent, safeFilename } from './repositories/documents.mappers.js';
import { mapTermReportRevision } from './repositories/marks.mappers.js';
import { fromMysqlDateTime } from './repositories/platform.mappers.js';
import {
  addisDate, auditRow, campusScopeError, now, planLimitError, scheduleConflict, setupConflict
} from './repositories/shared.js';
import { formatStaffName, mapStaff } from './repositories/staff.mappers.js';










export class MemoryRepository {
  constructor({ users, campuses, sections, academicYears, gradeLevels = [], subjects = [], staff = [], departments = [], sensitiveDataKey = '' }) {
    this.users = users;
    this.campuses = campuses;
    for (const campus of campuses) campus.admissionsPublicToken ??= randomBytes(32).toString('hex');
    this.organizations = [];
    this.subscriptionPlans = [{
      id: randomUUID(), code: 'starter', name: 'Starter', description: 'Initial private-school trial plan',
      monthlyPrice: 0, currencyCode: 'ETB', trialDays: 30, studentLimit: 100,
      staffLimit: 20, siteLimit: 1, modules: [
        'academic_setup', 'student_information', 'admissions', 'attendance',
        'marks', 'fees', 'staff', 'timetable', 'communications'
      ],
      isActive: true
    }];
    this.subscriptions = [];
    const demoUser = users.find((user) => user.orgId && user.role !== 'super_admin');
    const demoCampusIds = new Set(demoUser?.campusIds ?? [demoUser?.activeCampusId].filter(Boolean));
    const demoCampuses = campuses.filter((campus) =>
      campus.organizationId === demoUser?.orgId ||
      (!campus.organizationId && demoCampusIds.has(campus.id)));
    for (const campus of demoCampuses) campus.organizationId ??= demoUser.orgId;
    if (demoUser) {
      this.organizations.push({
        id: demoUser.orgId, name: demoCampuses[0]?.organizationName ?? demoCampuses[0]?.name ?? 'School',
        status: 'active', preferredLocale: 'en', currencyCode: 'ETB',
        branding: { logoUrl: '', primaryColor: '#0f766e' }, requestedAt: null,
        activatedAt: now(), suspendedAt: null, closedAt: null
      });
      this.subscriptions.push({
        id: randomUUID(), organizationId: demoUser.orgId, planId: this.subscriptionPlans[0].id,
        status: 'active', trialStartedAt: null, trialEndsAt: null,
        periodStartedAt: null, periodEndsAt: null
      });
    }
    this.subscriptionInvoices = [];
    this.subscriptionPayments = [];
    this.closureRequests = [];
    this.sections = sections;
    this.academicYears = academicYears;
    this.gradeLevels = gradeLevels;
    this.gradeSubjects = [];
    this.schoolCalendarEntries = [];
    this.curriculumUnits = [];
    this.lessonPlans = [];
    this.promotionRules = [];
    this.subjects = subjects;
    this.staff = staff;
    this.departments = departments;
    this.timetablePeriods = [];
    this.rooms = [];
    this.timetableSubstitutions = [];
    this.admissions = [];
    this.admissionDocuments = [];
    this.studentStatusHistory = [];
    this.studentSiblingLinks = [];
    this.studentCommendations = [];
    this.studentEmergencyContacts = [];
    this.guardians = [];
    this.studentGuardians = [];
    this.admissionCounters = new Map();
    this.teachingAssignments = [];
    this.homeroomAssignments = [];
    this.staffAttendance = [];
    this.leaveRequests = [];
    this.staffMessages = [];
    this.campusAnnouncements = [];
    this.campusEvents = [];
    this.userNotifications = [];
    this.students = [];
    this.enrolments = [];
    this.studentSensitive = new Map();
    this.studentDocuments = [];
    this.studentSectionTransfers = [];
    this.studentDisciplineRecords = [];
    this.studentTransferPackages = [];
    this.sensitiveDataKey = sensitiveDataKey;
    this.attendance = [];
    this.attendanceCorrectionRequests = [];
    this.marks = [];
    this.gradingBands = [];
    this.gradingPolicies = [];
    this.termReportRevisions = [];
    this.feeItems = [];
    this.feeInvoices = [];
    this.feePayments = [];
    this.cashierShifts = [];
    this.feeExpenses = [];
    this.audit = [];
    this.loginFailures = new Map();
    this.refreshTokens = new Map();
    this.passwordResetTokens = new Map();
    this.accountInvitations = [];
    this.mode = 'memory';
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
      recentStudents: students.slice(0, 5).map((student) => ({ ...student, guardianPhone: null })),
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
  async getPublicAdmissionInfo(token) {
    const campus = this.campuses.find((item) =>
      item.admissionsPublicToken === token && item.isActive !== false);
    if (!campus || !this.academicYears.some((year) =>
      year.campusId === campus.id && year.status === 'active')) return null;
    return {
      schoolName: this.organizations.find((item) => item.id === campus.organizationId)?.name ?? campus.name,
      campusName: campus.name, address: campus.address ?? '', phone: campus.phone ?? '',
      grades: this.gradeLevels.filter((grade) => grade.campusId === campus.id)
        .map(({ id, nameEn, nameAm }) => ({ id, nameEn, nameAm }))
    };
  }
  async getAdmissionsPublicToken(campusId) {
    return this.campuses.find((item) => item.id === campusId)?.admissionsPublicToken ?? null;
  }
  async createPublicAdmission(token, data) {
    const info = await this.getPublicAdmissionInfo(token);
    const campus = this.campuses.find((item) =>
      item.admissionsPublicToken === token && item.isActive !== false);
    if (!info || !campus) return null;
    const admission = await this.createAdmission(data, {
      sub: 'public-intake', orgId: campus.organizationId,
      activeCampusId: campus.id
    });
    const row = this.admissions.find((item) => item.id === admission.id);
    row.status = 'application';
    row.publicSubmission = true;
    row.privacyConsentAt = now();
    return this.mapAdmission(row);
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
      status: actor.sub === 'public-intake' ? 'application' : 'enquiry',
      publicSubmission: actor.sub === 'public-intake',
      privacyConsentAt: actor.sub === 'public-intake' ? now() : null,
      requiredDocuments: ['birth_certificate', 'previous_school_report', 'guardian_id'],
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
    const generated = await generateStudentCredentials(student, (username) =>
      this.users.some((user) => user.username?.toLowerCase() === username.toLowerCase()));
    const user = {
      id: randomUUID(), orgId: actor.orgId, name: studentName(student), email: null, phone: null,
      username: generated.username, passwordHash: generated.passwordHash, role: 'student',
      campusIds: [actor.activeCampusId], activeCampusId: actor.activeCampusId,
      isActive: true, mustChangePassword: true
    };
    student.userId = user.id;
    student.hasPortalAccount = true;
    this.users.push(user);
    this.students.unshift(student);
    this.enrolments.push({
      id: randomUUID(), studentId: student.id, academicYearId: admission.academicYearId,
      sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
    });
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
    await this.appendAudit(actor, 'student.account_created', 'user', user.id, null, {
      studentId: student.id, username: user.username
    });
    return {
      student, admission: this.mapAdmission(admission),
      credentials: {
        username: user.username, temporaryPassword: generated.temporaryPassword,
        studentName: generated.studentName
      }
    };
  }










  async close() {}
}

export class MysqlRepository {
  constructor(knex, privateDocumentsDir, sensitiveDataKey = '') {
    this.db = knex;
    this.mode = 'mysql';
    this.loginFailures = new Map();
    this.privateDocumentsDir = path.resolve(privateDocumentsDir);
    this.sensitiveDataKey = sensitiveDataKey;
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
      recentStudents: recentStudents.slice(0, 5).map((student) => ({ ...student, guardianPhone: null })),
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
  async getPublicAdmissionInfo(token) {
    const campus = await this.db('campuses').where({
      admissions_public_token: token, is_active: true
    }).first();
    if (!campus) return null;
    const year = await this.db('academic_years').where({
      campus_id: campus.id, status: 'active'
    }).first('id');
    if (!year) return null;
    const grades = await this.db('grade_levels').where({ campus_id: campus.id })
      .orderBy('sort_order').select('id', 'name_en', 'name_am');
    const organization = await this.db('organizations').where({ id: campus.organization_id }).first('name');
    return {
      schoolName: organization?.name ?? campus.name, campusName: campus.name,
      address: campus.address ?? '', phone: campus.phone ?? '',
      grades: grades.map((grade) => ({ id: grade.id, nameEn: grade.name_en, nameAm: grade.name_am }))
    };
  }
  async getAdmissionsPublicToken(campusId) {
    const campus = await this.db('campuses').where({ id: campusId, is_active: true })
      .first('admissions_public_token');
    return campus?.admissions_public_token ?? null;
  }
  async createPublicAdmission(token, data) {
    const campus = await this.db('campuses').where({
      admissions_public_token: token, is_active: true
    }).first('id', 'organization_id');
    if (!campus || !await this.getPublicAdmissionInfo(token)) return null;
    return this.createAdmission(data, {
      sub: 'public-intake', orgId: campus.organization_id, activeCampusId: campus.id
    });
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
      previous_school: data.previousSchool ?? null,
      status: actor.sub === 'public-intake' ? 'application' : 'enquiry',
      public_submission: actor.sub === 'public-intake',
      privacy_consent_at: actor.sub === 'public-intake' ? new Date() : null,
      required_documents: JSON.stringify(['birth_certificate', 'previous_school_report', 'guardian_id']),
      created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('admissions').insert(admission);
      await trx('audit_log').insert(auditRow(actor, 'admission.created', 'admission', id, null, data));
    });
    return this.getAdmission(actor.activeCampusId, id);
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
      const studentData = {
        givenNameEn: admission.given_name_en, fatherNameEn: admission.father_name_en,
        grandfatherNameEn: admission.grandfather_name_en,
        studentNo, givenNameAm: admission.given_name_am, fatherNameAm: admission.father_name_am,
        grandfatherNameAm: admission.grandfather_name_am
      };
      const generated = await generateStudentCredentials(studentData, async (username) =>
        Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')));
      const userId = randomUUID();
      await trx('users').insert({
        id: userId, organization_id: actor.orgId, name: studentName(studentData),
        username: generated.username, password_hash: generated.passwordHash,
        role: 'student', must_change_password: true, is_active: true
      });
      await trx('user_campuses').insert({
        user_id: userId, campus_id: actor.activeCampusId, is_active: true
      });
      await trx('students').insert({
        id: studentId, campus_id: actor.activeCampusId, student_no: studentNo,
        user_id: userId, status: 'enrolled',
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
      await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
        studentId, username: generated.username
      }));
      return {
        studentId, studentNo,
        credentials: {
          username: generated.username, temporaryPassword: generated.temporaryPassword,
          studentName: generated.studentName
        }
      };
    });
    const studentRow = await this.db('students').where({ id: result.studentId }).first();
    return {
      student: mapStudent(studentRow), admission: await this.getAdmission(actor.activeCampusId, admissionId),
      credentials: result.credentials
    };
  }










  async close() { await this.db.destroy(); }
}

Object.assign(MemoryRepository.prototype, composeRepositoryBundles({
  communications: memoryCommunicationsBundle,
  staff: memoryStaffBundle,
  fees: memoryFeesBundle,
  attendance: memoryAttendanceBundle,
  marks: memoryMarksBundle,
  timetable: memoryTimetableBundle,
  platform: memoryPlatformBundle,
  accounts: memoryAccountsBundle,
  portal: memoryPortalBundle,
  academic: memoryAcademicBundle,
  students: memoryStudentsBundle
}));
Object.assign(MysqlRepository.prototype, composeRepositoryBundles({
  communications: mysqlCommunicationsBundle,
  staff: mysqlStaffBundle,
  fees: mysqlFeesBundle,
  attendance: mysqlAttendanceBundle,
  marks: mysqlMarksBundle,
  timetable: mysqlTimetableBundle,
  platform: mysqlPlatformBundle,
  accounts: mysqlAccountsBundle,
  portal: mysqlPortalBundle,
  academic: mysqlAcademicBundle,
  students: mysqlStudentsBundle
}));

















































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
    status: row.status, publicSubmission: Boolean(row.public_submission ?? row.publicSubmission),
    requiredDocuments,
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


























export async function createRepository(config) {
  if (config.STORAGE_MODE === 'mysql') {
    const db = knexFactory({
      client: 'mysql2',
      connection: {
        ...(config.DB_SOCKET_PATH
          ? { socketPath: config.DB_SOCKET_PATH }
          : { host: config.DB_HOST, port: config.DB_PORT }),
        user: config.DB_USER,
        password: config.DB_PASSWORD, database: config.DB_NAME, charset: 'utf8mb4',
        dateStrings: true
      },
      pool: { min: 0, max: 10 }
    });
    await db.raw('SELECT 1');
    return new MysqlRepository(
      db, config.PRIVATE_DOCUMENTS_DIR ?? '.private/admissions', config.SENSITIVE_DATA_KEY ?? ''
    );
  }
  const userId = '10000000-0000-4000-8000-000000000001';
  const orgId = '20000000-0000-4000-8000-000000000001';
  const campusId = '30000000-0000-4000-8000-000000000001';
  const passwordHash = await bcrypt.hash(config.DEMO_LOGIN_PASSWORD, 12);
  const repo = new MemoryRepository({
    sensitiveDataKey: config.SENSITIVE_DATA_KEY ?? '',
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
      academicYearId: '50000000-0000-4000-8000-000000000001',
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
  repo.enrolments = repo.students.map((student) => ({
    id: randomUUID(), studentId: student.id, academicYearId: '50000000-0000-4000-8000-000000000001',
    sectionId: '70000000-0000-4000-8000-000000000001', status: 'active',
    enrolledOn: addisDate(), leftOn: null, outcome: null
  }));
  return repo;
}
