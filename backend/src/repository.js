import bcrypt from 'bcrypt';
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
import { mysqlAcademicBundle } from './repositories/mysql/academic.repository.js';
import {
  attendanceCorrectionConflict, attendanceCorrectionWindowOpen, buildAttendanceSummary
} from './repositories/attendance.mappers.js';
import { mapStudent, studentName } from './repositories/students.mappers.js';
import { mapTermReportRevision } from './repositories/marks.mappers.js';
import { fromMysqlDateTime } from './repositories/platform.mappers.js';
import {
  addisDate, auditRow, campusScopeError, now, planLimitError, scheduleConflict, setupConflict
} from './repositories/shared.js';
import { formatStaffName, mapStaff } from './repositories/staff.mappers.js';



function normalizeImportValue(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function studentImportReports(rows, sections, existingStudents) {
  const reports = rows.map(({ rowNumber, data }) => ({
    rowNumber, eligible: true, errors: [], warnings: []
  }));
  const reportByRow = new Map(reports.map((report) => [report.rowNumber, report]));
  const sectionCounts = new Map();
  for (const section of sections) {
    const key = normalizeImportValue(section.name);
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }
  const existingStudentNumbers = new Set(existingStudents.map((student) =>
    normalizeImportValue(student.studentNo)));
  const existingIdentities = new Set(existingStudents.flatMap((student) =>
    student.dateOfBirth ? [
      `${normalizeImportValue([student.givenNameEn, student.fatherNameEn, student.grandfatherNameEn].join(' '))}|${String(student.dateOfBirth).slice(0, 10)}`,
      `${normalizeImportValue([student.givenNameAm, student.fatherNameAm, student.grandfatherNameAm].join(' '))}|${String(student.dateOfBirth).slice(0, 10)}`
    ] : []));
  const existingPhones = new Set(existingStudents.map((student) =>
    String(student.guardianPhone ?? '').replace(/\D/g, '')).filter(Boolean));
  const seenNumbers = new Map();
  const seenIdentities = new Map();
  const seenPhones = new Set();
  const addError = (report, field, message) => {
    report.eligible = false;
    report.errors.push({ field, message });
  };
  for (const { rowNumber, data } of rows) {
    const report = reportByRow.get(rowNumber);
    const sectionKey = normalizeImportValue(data.sectionName);
    const sectionCount = sectionCounts.get(sectionKey) ?? 0;
    if (sectionCount === 0) addError(report, 'sectionName', 'Section is not active in this campus and academic year.');
    else if (sectionCount > 1) addError(report, 'sectionName', 'Section name is ambiguous; use a unique active section name.');

    const studentNumber = normalizeImportValue(data.studentNo);
    if (existingStudentNumbers.has(studentNumber)) {
      addError(report, 'studentNo', 'Student ID already exists at this campus.');
    }
    if (seenNumbers.has(studentNumber)) {
      addError(report, 'studentNo', `Student ID is repeated on row ${seenNumbers.get(studentNumber)}.`);
    } else {
      seenNumbers.set(studentNumber, rowNumber);
    }

    if (data.dateOfBirth) {
      const identities = [
        `${normalizeImportValue([data.givenNameEn, data.fatherNameEn, data.grandfatherNameEn].join(' '))}|${data.dateOfBirth}`,
        `${normalizeImportValue([data.givenNameAm, data.fatherNameAm, data.grandfatherNameAm].join(' '))}|${data.dateOfBirth}`
      ];
      const duplicateIdentity = identities.some((identity) =>
        existingIdentities.has(identity) || seenIdentities.has(identity));
      if (duplicateIdentity) addError(report, 'dateOfBirth', 'A student with the same name and date of birth already exists.');
      for (const identity of identities) seenIdentities.set(identity, rowNumber);
    }

    const phone = String(data.guardianPhone ?? '').replace(/\D/g, '');
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) {
      report.warnings.push({
        field: 'guardianPhone',
        message: 'Guardian phone is already linked to another student; sibling records may share a phone.'
      });
    }
    if (phone) seenPhones.add(phone);
  }
  return reports;
}
function usernamePart(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'student';
}
async function generateStudentCredentials(student, usernameExists) {
  const base = [student.givenNameEn, student.fatherNameEn, student.studentNo]
    .map(usernamePart).join('.').slice(0, 70).replace(/\.+$/g, '');
  let username = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    username = `${base}.${randomBytes(4).toString('hex')}`;
    if (!await usernameExists(username)) break;
    username = '';
  }
  if (!username) throw new Error('Unable to generate a unique student username.');
  const temporaryPassword = randomBytes(18).toString('hex');
  return {
    username, temporaryPassword, studentName: studentName(student),
    passwordHash: await bcrypt.hash(temporaryPassword, 12)
  };
}



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
























  async listStudents(campusId) {
    return this.students.filter((student) => student.campusId === campusId && !student.archivedAt)
      .map((student) => {
        const section = this.sections.find((item) =>
          item.campusId === campusId && item.name === student.sectionName);
        return {
          ...student, sectionId: section?.id ?? null,
          gradeLevelId: section?.gradeLevelId ?? null, stream: section?.stream ?? null
        };
      });
  }
  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    const names = new Set(this.sections.filter((section) => accessible.has(section.id)).map((section) => section.name));
    return (await this.listStudents(actor.activeCampusId))
      .filter((student) => names.has(student.sectionName))
      .map((student) => studentForActor(student, actor));
  }
  async updateStudentProfile(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const changedFields = Object.keys(data).filter((field) => student[field] !== data[field]);
    Object.assign(student, data);
    await this.appendAudit(actor, 'student.profile_updated', 'student', student.id, null, { fields: changedFields });
    return student;
  }
  async getStudentSensitiveData(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const stored = this.studentSensitive.get(studentId) ?? {};
    const data = {
      idNumber: decryptSensitiveValue(stored.idNumberEnc, this.sensitiveDataKey),
      healthNotes: decryptSensitiveValue(stored.healthNotesEnc, this.sensitiveDataKey),
      specialNeeds: decryptSensitiveValue(stored.specialNeedsEnc, this.sensitiveDataKey),
      allergies: decryptSensitiveValue(stored.allergiesEnc, this.sensitiveDataKey)
    };
    await this.appendAudit(actor, 'student.sensitive_data_viewed', 'student', studentId, null, {
      fields: Object.keys(data)
    });
    return data;
  }
  async updateStudentSensitiveData(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const previous = this.studentSensitive.get(studentId) ?? {};
    const next = {
      idNumberEnc: Object.hasOwn(data, 'idNumber')
        ? encryptSensitiveValue(data.idNumber, this.sensitiveDataKey) : previous.idNumberEnc ?? null,
      idNumberHash: Object.hasOwn(data, 'idNumber')
        ? hashSensitiveIdentifier(data.idNumber, this.sensitiveDataKey) : previous.idNumberHash ?? null,
      healthNotesEnc: Object.hasOwn(data, 'healthNotes')
        ? encryptSensitiveValue(data.healthNotes, this.sensitiveDataKey) : previous.healthNotesEnc ?? null,
      specialNeedsEnc: Object.hasOwn(data, 'specialNeeds')
        ? encryptSensitiveValue(data.specialNeeds, this.sensitiveDataKey) : previous.specialNeedsEnc ?? null,
      allergiesEnc: Object.hasOwn(data, 'allergies')
        ? encryptSensitiveValue(data.allergies, this.sensitiveDataKey) : previous.allergiesEnc ?? null
    };
    this.studentSensitive.set(studentId, next);
    await this.appendAudit(actor, 'student.sensitive_data_updated', 'student', studentId, null, {
      fields: Object.keys(data)
    });
    return {
      idNumber: decryptSensitiveValue(next.idNumberEnc, this.sensitiveDataKey),
      healthNotes: decryptSensitiveValue(next.healthNotesEnc, this.sensitiveDataKey),
      specialNeeds: decryptSensitiveValue(next.specialNeedsEnc, this.sensitiveDataKey),
      allergies: decryptSensitiveValue(next.allergiesEnc, this.sensitiveDataKey)
    };
  }
  async listStudentEmergencyContacts(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const contacts = this.studentEmergencyContacts
      .filter((item) => item.studentId === studentId && item.campusId === actor.activeCampusId)
      .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
      .map((item) => ({
        id: item.id, studentId, name: decryptSensitiveValue(item.nameEnc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(item.phoneEnc, this.sensitiveDataKey),
        relationship: item.relationship, priority: item.priority, createdAt: item.createdAt
      }));
    await this.appendAudit(actor, 'student.emergency_contacts_viewed', 'student', studentId, null, {
      count: contacts.length
    });
    return contacts;
  }
  async addStudentEmergencyContact(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const contact = {
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      nameEnc: encryptSensitiveValue(data.name, this.sensitiveDataKey),
      phoneEnc: encryptSensitiveValue(data.phone, this.sensitiveDataKey),
      relationship: data.relationship, priority: data.priority, createdAt: now()
    };
    this.studentEmergencyContacts.push(contact);
    await this.appendAudit(actor, 'student.emergency_contact_added', 'student_emergency_contact',
      contact.id, null, {
        studentId, fields: ['name', 'phone', 'relationship', 'priority'], priority: data.priority
      });
    return {
      id: contact.id, studentId, name: data.name, phone: data.phone,
      relationship: data.relationship, priority: data.priority, createdAt: contact.createdAt
    };
  }
  async removeStudentEmergencyContact(studentId, contactId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return false;
    const index = this.studentEmergencyContacts.findIndex((item) =>
      item.id === contactId && item.studentId === studentId && item.campusId === actor.activeCampusId);
    if (index < 0) return false;
    const [contact] = this.studentEmergencyContacts.splice(index, 1);
    await this.appendAudit(actor, 'student.emergency_contact_removed', 'student_emergency_contact',
      contact.id, null, { studentId });
    return true;
  }
  async listStudentGuardians(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    return this.studentGuardians.filter((link) => link.studentId === studentId)
      .map((link) => {
        const guardian = this.guardians.find((item) => item.id === link.guardianId && item.orgId === actor.orgId);
        return guardian ? mapStudentGuardian({ ...guardian, relationship: link.relationship, isPrimary: link.isPrimary,
            isVerified: Boolean(link.isVerified), canViewResults: Boolean(link.canViewResults),
            canViewFees: Boolean(link.canViewFees) }) : null;
      }).filter(Boolean);
  }
  async listStudentCommendations(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    return this.studentCommendations.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn) || b.createdAt.localeCompare(a.createdAt));
  }
  async createStudentCommendation(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const commendation = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId, ...data,
      createdBy: actor.sub, createdAt: now()
    };
    this.studentCommendations.push(commendation);
    await this.appendAudit(actor, 'student.commendation.created', 'student_commendation',
      commendation.id, null, {
        studentId, recordedOn: data.recordedOn, titleEn: data.titleEn, titleAm: data.titleAm
      });
    return commendation;
  }
  async addStudentGuardian(studentId, data, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) {
      const error = new Error('Student is outside the active campus.');
      error.code = 'CAMPUS_SCOPE_VIOLATION';
      throw error;
    }
    if (data.isPrimary) {
      this.studentGuardians.filter((link) => link.studentId === studentId).forEach((link) => { link.isPrimary = false; });
    }
    const guardian = {
      id: randomUUID(), orgId: actor.orgId,
      givenNameAm: data.givenNameAm, fatherNameAm: data.fatherNameAm,
      grandfatherNameAm: data.grandfatherNameAm, givenNameEn: data.givenNameEn,
      fatherNameEn: data.fatherNameEn, grandfatherNameEn: data.grandfatherNameEn,
      phone: data.phone, email: data.email ?? null, userId: null
    };
    const link = {
      studentId, guardianId: guardian.id, relationship: data.relationship, isPrimary: data.isPrimary,
      isVerified: false, canViewResults: false, canViewFees: false
    };
    this.guardians.push(guardian);
    this.studentGuardians.push(link);
    await this.appendAudit(actor, 'student.guardian_linked', 'student', studentId, null,
      { guardianId: guardian.id, relationship: data.relationship, isPrimary: data.isPrimary });
    return mapStudentGuardian({ ...guardian, relationship: data.relationship, isPrimary: data.isPrimary,
      isVerified: false, canViewResults: false, canViewFees: false });
  }
  async removeStudentGuardian(studentId, guardianId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return false;
    const index = this.studentGuardians.findIndex((link) =>
      link.studentId === studentId && link.guardianId === guardianId);
    if (index < 0) return false;
    const [link] = this.studentGuardians.splice(index, 1);
    await this.appendAudit(actor, 'student.guardian_unlinked', 'student', studentId, null,
      { guardianId, relationship: link.relationship });
    return true;
  }
  async createStudent(data, actor) {
    await this.assertStudentCapacity(actor.orgId, 1);
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
    const credentials = await generateStudentCredentials(student, (username) =>
      this.users.some((user) => user.username?.toLowerCase() === username.toLowerCase()));
    const user = {
      id: randomUUID(), orgId: actor.orgId, name: studentName(student),
      email: null, phone: null, username: credentials.username,
      passwordHash: credentials.passwordHash, role: 'student',
      campusIds: [actor.activeCampusId], activeCampusId: actor.activeCampusId,
      isActive: true, mustChangePassword: true
    };
    student.userId = user.id;
    student.hasPortalAccount = true;
    this.users.push(user);
    this.students.unshift(student);
    const academicYear = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active' &&
      (!section.academicYearId || item.id === section.academicYearId));
    if (academicYear) this.enrolments.push({
      id: randomUUID(), studentId: student.id, academicYearId: academicYear.id,
      sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
    });
    await this.appendAudit(actor, 'student.created', 'student', student.id, null,
      { studentNo: student.studentNo, sectionName: student.sectionName, fields: Object.keys(data) });
    await this.appendAudit(actor, 'student.account_created', 'user', user.id, null, {
      studentId: student.id, username: user.username
    });
    return { student, credentials: {
      username: user.username, temporaryPassword: credentials.temporaryPassword,
      studentName: credentials.studentName
    } };
  }
  async assertStudentCapacity(organizationId, additional = 1) {
    const subscription = this.subscriptions.find((item) => item.organizationId === organizationId);
    const plan = subscription && this.subscriptionPlans.find((item) => item.id === subscription.planId);
    if (plan?.studentLimit == null) return;
    const campusIds = new Set(this.campuses.filter((campus) =>
      campus.organizationId === organizationId).map((campus) => campus.id));
    const count = this.students.filter((student) =>
      campusIds.has(student.campusId) && !student.archivedAt).length;
    if (count + additional > plan.studentLimit) throw planLimitError('student', plan.studentLimit);
  }
  async previewStudentImport(rows, actor) {
    const sections = this.sections.filter((section) =>
      section.campusId === actor.activeCampusId && section.isActive !== false);
    const existingStudents = this.students.filter((student) =>
      student.campusId === actor.activeCampusId && !student.archivedAt);
    return studentImportReports(rows, sections, existingStudents);
  }
  async importStudents(rows, actor) {
    const reports = await this.previewStudentImport(rows, actor);
    const eligibleRows = rows.filter((row) =>
      reports.find((report) => report.rowNumber === row.rowNumber)?.eligible);
    await this.assertStudentCapacity(actor.orgId, eligibleRows.length);
    const stagedStudents = await Promise.all(eligibleRows.map(async ({ rowNumber, data }) => {
      const generated = await generateStudentCredentials(data, (username) =>
        this.users.some((user) => user.username?.toLowerCase() === username.toLowerCase()));
      const user = {
        id: randomUUID(), orgId: actor.orgId, name: studentName(data),
        email: null, phone: null, username: generated.username,
        passwordHash: generated.passwordHash, role: 'student',
        campusIds: [actor.activeCampusId], activeCampusId: actor.activeCampusId,
        isActive: true, mustChangePassword: true
      };
      const student = {
        id: randomUUID(), ...data, campusId: actor.activeCampusId,
        status: 'enrolled', createdAt: now(), userId: user.id, hasPortalAccount: true
      };
      return { rowNumber, student, user, credentials: {
        studentName: generated.studentName, username: generated.username,
        temporaryPassword: generated.temporaryPassword
      } };
    }));
    this.users.push(...stagedStudents.map((entry) => entry.user));
    this.students.unshift(...stagedStudents.map((entry) => entry.student));
    for (const entry of stagedStudents) {
      const section = this.sections.find((item) =>
        item.campusId === actor.activeCampusId && item.isActive &&
        item.name === entry.student.sectionName);
      const academicYear = section && this.academicYears.find((item) =>
        item.campusId === actor.activeCampusId && item.status === 'active' &&
        (!section.academicYearId || item.id === section.academicYearId));
      if (section && academicYear) this.enrolments.push({
        id: randomUUID(), studentId: entry.student.id, academicYearId: academicYear.id,
        sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
      await this.appendAudit(actor, 'student.created', 'student', entry.student.id, null, {
        studentNo: entry.student.studentNo, sectionName: entry.student.sectionName,
        fields: Object.keys(entry.student).filter((field) => !['id', 'campusId', 'status', 'createdAt', 'userId', 'hasPortalAccount'].includes(field))
      });
      await this.appendAudit(actor, 'student.account_created', 'user', entry.user.id, null, {
        studentId: entry.student.id, username: entry.user.username
      });
    }
    return { reports, createdCount: stagedStudents.length, credentials: stagedStudents.map((entry) => ({
      rowNumber: entry.rowNumber, studentNo: entry.student.studentNo, ...entry.credentials
    })) };
  }
  async hasStudents(campusId, ids) {
    const found = this.students.filter((s) => s.campusId === campusId && ids.includes(s.id));
    return found.length === ids.length;
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
  async storeStudentDocument(studentId, documentType, originalName, mimeType, content, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content) ||
      (documentType === 'photo' && !['image/jpeg', 'image/png'].includes(mimeType))) {
      throw invalidDocument('The student document content does not match its declared file type.');
    }
    const document = {
      id: randomUUID(), studentId, campusId: actor.activeCampusId, documentType,
      originalName: safeFilename(originalName), mimeType, sizeBytes: content.length,
      storageKey: randomUUID(), sha256: createHash('sha256').update(content).digest('hex'),
      uploadedBy: actor.sub, createdAt: now(), content: Buffer.from(content)
    };
    this.studentDocuments.push(document);
    await this.appendAudit(actor, 'student.document_uploaded', 'student_document', document.id, null, {
      studentId, documentType, sizeBytes: content.length, sha256: document.sha256
    });
    return mapStudentDocument(document);
  }
  async listStudentDocuments(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    await this.appendAudit(actor, 'student.documents_viewed', 'student', studentId, null, null);
    return this.studentDocuments.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map(mapStudentDocument);
  }
  async getStudentDocument(studentId, documentId, actor) {
    const document = this.studentDocuments.find((item) =>
      item.id === documentId && item.studentId === studentId && item.campusId === actor.activeCampusId);
    if (!document || !this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    await this.appendAudit(actor, 'student.document_downloaded', 'student_document', documentId, null, { studentId });
    return { document: mapStudentDocument(document), content: document.content };
  }
  async createStudentTransferPackage(studentId, data, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const consent = this.studentDocuments.find((item) =>
      item.id === data.consentDocumentId && item.studentId === studentId &&
      item.campusId === actor.activeCampusId && item.documentType === 'transfer_consent');
    if (!consent) throw setupConflict('Upload the guardian-signed transfer consent document before requesting approval.');
    const item = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId,
      recipientSchool: data.recipientSchool, guardianName: data.guardianName,
      guardianRelationship: data.guardianRelationship, consentRecordedOn: data.consentRecordedOn,
      consentDocumentId: consent.id, status: 'pending', shareTokenHash: null,
      expiresAt: null, approvedBy: null, approvedAt: null, createdBy: actor.sub, createdAt: now()
    };
    this.studentTransferPackages.unshift(item);
    await this.appendAudit(actor, 'student.transfer_package_requested', 'student_transfer_package',
      item.id, null, { studentId, recipientSchool: item.recipientSchool, consentRecordedOn: item.consentRecordedOn });
    return mapStudentTransferPackage(item);
  }
  async listStudentTransferPackages(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    return this.studentTransferPackages.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map(mapStudentTransferPackage);
  }
  async approveStudentTransferPackage(packageId, tokenHash, actor) {
    const item = this.studentTransferPackages.find((entry) =>
      entry.id === packageId && entry.campusId === actor.activeCampusId);
    if (!item) return null;
    if (!['pending', 'approved'].includes(item.status)) throw setupConflict('Only pending or approved transfer packages can receive a transfer link.');
    const previousStatus = item.status;
    item.status = 'approved';
    item.shareTokenHash = tokenHash;
    item.expiresAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
    item.approvedBy = actor.sub;
    item.approvedAt = now();
    await this.appendAudit(actor,
      previousStatus === 'pending' ? 'student.transfer_package_approved' : 'student.transfer_link_reissued',
      'student_transfer_package', packageId, { status: previousStatus },
      { status: 'approved', expiresAt: item.expiresAt });
    return mapStudentTransferPackage(item);
  }
  async getStudentTransferPackageByTokenHash(tokenHash) {
    const item = this.studentTransferPackages.find((entry) =>
      entry.shareTokenHash === tokenHash && entry.status === 'approved' &&
      Date.parse(entry.expiresAt) > Date.now());
    if (!item) return null;
    const student = this.students.find((entry) =>
      entry.id === item.studentId && entry.campusId === item.campusId && !entry.archivedAt);
    if (!student) return null;
    const actor = { activeCampusId: item.campusId };
    const history = this.enrolments.filter((entry) => entry.studentId === item.studentId)
      .map((entry) => {
        const section = this.sections.find((row) => row.id === entry.sectionId);
        const year = this.academicYears.find((row) => row.id === entry.academicYearId);
        return section && year ? { academicYear: year.labelEc, grade: section.gradeName ?? '',
          section: section.name, status: entry.status, outcome: entry.outcome ?? null } : null;
      }).filter(Boolean);
    const campus = this.campuses.find((entry) => entry.id === actor.activeCampusId);
    return {
      recipientSchool: item.recipientSchool,
      sourceSchool: campus?.name ?? 'School',
      student: {
        studentNo: student.studentNo,
        givenNameAm: student.givenNameAm, fatherNameAm: student.fatherNameAm,
        grandfatherNameAm: student.grandfatherNameAm, givenNameEn: student.givenNameEn,
        fatherNameEn: student.fatherNameEn, grandfatherNameEn: student.grandfatherNameEn,
        gender: student.gender, dateOfBirth: student.dateOfBirth ?? null,
        previousSchool: student.previousSchool ?? null
      },
      guardianConsent: {
        guardianName: item.guardianName, relationship: item.guardianRelationship,
        recordedOn: item.consentRecordedOn
      },
      academicHistory: history
    };
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
  async changeStudentStatus(studentId, status, reason, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can be withdrawn or transferred.');
    const before = { status: student.status, sectionName: student.sectionName };
    student.status = status;
    this.enrolments.filter((item) => item.studentId === studentId && item.status === 'active')
      .forEach((item) => {
        item.status = 'withdrawn';
        item.leftOn = addisDate();
        item.outcome = status;
      });
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
    const academicYear = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active' &&
      (!section.academicYearId || section.academicYearId === item.id));
    if (academicYear) {
      const existing = this.enrolments.find((item) =>
        item.studentId === studentId && item.academicYearId === academicYear.id);
      if (existing) Object.assign(existing, {
        sectionId: section.id, status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
      else this.enrolments.push({
        id: randomUUID(), studentId, academicYearId: academicYear.id, sectionId: section.id,
        status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
    }
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission) linkedAdmission.status = 'enrolled';
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status: 'enrolled', reason, recordedBy: actor.sub, createdAt: now()
    });
    await this.appendAudit(actor, 'student.readmitted', 'student', studentId, before, student);
    return student;
  }
  async listStudentEnrollmentHistory(studentId, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s active section.');
    }
    return this.enrolments.filter((item) => item.studentId === studentId)
      .map((item) => {
        const section = this.sections.find((entry) => entry.id === item.sectionId &&
          entry.campusId === actor.activeCampusId);
        const year = this.academicYears.find((entry) => entry.id === item.academicYearId &&
          entry.campusId === actor.activeCampusId);
        const grade = this.gradeLevels.find((entry) => entry.id === section?.gradeLevelId);
        return section && year ? {
          id: item.id, academicYearId: year.id, academicYear: year.labelEc,
          gradeLevelId: grade?.id ?? null, gradeNameEn: grade?.nameEn ?? section.gradeName ?? null,
          gradeNameAm: grade?.nameAm ?? null, sectionId: section.id, sectionName: section.name,
          status: item.status, enrolledOn: item.enrolledOn, leftOn: item.leftOn ?? null,
          outcome: item.outcome ?? null, sortDate: year.startDate
        } : null;
      }).filter(Boolean)
      .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
      .map(({ sortDate, ...record }) => record);
  }
  async transferStudentSection(studentId, { sectionId, reason }, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only enrolled students can transfer sections.');
    const currentYear = this.academicYears.find((year) =>
      year.campusId === actor.activeCampusId && year.status === 'active');
    const enrollment = currentYear && this.enrolments.find((item) =>
      item.studentId === studentId && item.academicYearId === currentYear.id && item.status === 'active');
    const destination = this.sections.find((item) =>
      item.id === sectionId && item.campusId === actor.activeCampusId && item.isActive &&
      item.academicYearId === currentYear?.id);
    if (!enrollment || !destination) throw campusScopeError('Select a section in the active academic year at this campus.');
    if (enrollment.sectionId === destination.id) throw setupConflict('Student is already assigned to this section.');
    const count = this.enrolments.filter((item) =>
      item.sectionId === destination.id && item.status === 'active').length;
    if (destination.capacity != null && count >= destination.capacity) throw setupConflict('The selected section has reached capacity.');
    const sourceSectionId = enrollment.sectionId;
    enrollment.sectionId = destination.id;
    student.sectionName = destination.name;
    const transfer = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId, academicYearId: currentYear.id,
      fromSectionId: sourceSectionId, toSectionId: destination.id,
      reason, recordedBy: actor.sub, createdAt: now()
    };
    this.studentSectionTransfers.unshift(transfer);
    await this.appendAudit(actor, 'student.section_transferred', 'student', studentId,
      { sectionId: sourceSectionId }, { sectionId: destination.id, reason });
    return { ...student };
  }
  async listStudentSectionTransfers(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    return this.studentSectionTransfers.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId)
      .map((item) => ({
        ...item,
        fromSection: this.sections.find((section) => section.id === item.fromSectionId)?.name ?? '',
        toSection: this.sections.find((section) => section.id === item.toSectionId)?.name ?? ''
      }));
  }
  async listStudentDisciplineRecords(studentId, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const rows = this.studentDisciplineRecords.filter((item) =>
      item.studentId === studentId && item.campusId === actor.activeCampusId);
    await this.appendAudit(actor, 'student.discipline_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map((item) => mapStudentDisciplineRecord(item, this.sensitiveDataKey));
  }
  async createStudentDisciplineRecord(studentId, data, actor) {
    if (!this.students.some((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt)) return null;
    const record = {
      id: randomUUID(), campusId: actor.activeCampusId, studentId,
      recordedOn: data.recordedOn, category: data.category,
      detailsEnc: encryptSensitiveValue(data.details, this.sensitiveDataKey),
      actionTakenEnc: encryptSensitiveValue(data.actionTaken ?? null, this.sensitiveDataKey),
      recordedBy: actor.sub, createdAt: now()
    };
    this.studentDisciplineRecords.unshift(record);
    await this.appendAudit(actor, 'student.discipline_recorded', 'student_discipline_record',
      record.id, null, { studentId, recordedOn: data.recordedOn, category: data.category });
    return mapStudentDisciplineRecord(record, this.sensitiveDataKey);
  }
  async advanceStudent(studentId, { outcome, sectionId, reason, overrideReason }, actor) {
    const student = this.students.find((item) =>
      item.id === studentId && item.campusId === actor.activeCampusId && !item.archivedAt);
    if (!student) return null;
    if (student.status !== 'enrolled') throw setupConflict('Only an enrolled student can progress to a new academic year.');
    const year = this.academicYears.find((item) =>
      item.campusId === actor.activeCampusId && item.status === 'active');
    if (!year) throw setupConflict('Activate the destination academic year before recording progression.');
    if (this.enrolments.some((item) => item.studentId === studentId && item.academicYearId === year.id)) {
      throw setupConflict('The student already has an enrolment in the active academic year.');
    }
    const previous = this.enrolments.filter((item) => item.studentId === studentId)
      .map((item) => ({
        enrolment: item,
        year: this.academicYears.find((academicYear) =>
          academicYear.id === item.academicYearId && academicYear.campusId === actor.activeCampusId)
      }))
      .filter((item) => item.year?.status === 'closed' && item.enrolment.status === 'completed')
      .sort((a, b) => b.year.endDate.localeCompare(a.year.endDate))[0];
    if (!previous) throw setupConflict('A completed enrolment from a closed academic year is required.');

    const sourceSection = this.sections.find((item) => item.id === previous.enrolment.sectionId);
    const sourceGrade = this.gradeLevels.find((item) => item.id === sourceSection?.gradeLevelId);
    if (!sourceSection || !sourceGrade) throw setupConflict('The prior enrolment is missing its grade assignment.');
    if (outcome === 'graduated' && sourceGrade.sortOrder !== 12) {
      throw setupConflict('Only Grade 12 students can be recorded as graduates.');
    }

    let section = null;
    if (outcome !== 'graduated') {
      section = this.sections.find((item) =>
        item.id === sectionId && item.campusId === actor.activeCampusId &&
        item.academicYearId === year.id && item.isActive);
      if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
      const destinationGrade = this.gradeLevels.find((item) =>
        item.id === section.gradeLevelId && item.campusId === actor.activeCampusId);
      const expectedOrder = sourceGrade.sortOrder + (outcome === 'promoted' ? 1 : 0);
      if (!destinationGrade || destinationGrade.sortOrder !== expectedOrder) {
        throw setupConflict(outcome === 'promoted'
          ? 'Promotion must advance exactly one grade.'
          : 'Repetition must keep the student in the same grade.');
      }
      if (outcome === 'promoted') {
        const eligibility = await this.evaluateStudentProgression(studentId, actor);
        const overrideAllowed = ['owner_director', 'principal', 'system_admin'].includes(actor.role) &&
          Boolean(overrideReason?.trim());
        if (eligibility.status !== 'eligible' && !overrideAllowed) {
          throw setupConflict(`${eligibility.reason} A principal must configure the rule/results or provide an audited override reason.`);
        }
      }
      const count = this.enrolments.filter((item) =>
        item.sectionId === section.id && item.academicYearId === year.id && item.status === 'active').length;
      if (section.capacity != null && count >= section.capacity) {
        throw setupConflict('The selected section has reached capacity.');
      }
    }

    const before = { status: student.status, sectionName: student.sectionName };
    previous.enrolment.outcome = outcome;
    if (outcome === 'graduated') {
      student.status = 'graduated';
      student.sectionName = null;
    } else {
      this.enrolments.push({
        id: randomUUID(), studentId, academicYearId: year.id, sectionId: section.id,
        status: 'active', enrolledOn: addisDate(), leftOn: null, outcome: null
      });
      student.sectionName = section.name;
    }
    this.studentStatusHistory.unshift({
      id: randomUUID(), studentId, campusId: actor.activeCampusId,
      status: outcome, reason, recordedBy: actor.sub, createdAt: now()
    });
    const linkedAdmission = this.admissions.find((item) => item.studentId === studentId);
    if (linkedAdmission && outcome === 'graduated') linkedAdmission.status = 'graduated';
    await this.appendAudit(actor, `student.${outcome}`, 'student', studentId, before, {
      status: student.status, outcome, fromAcademicYearId: previous.year.id,
      toAcademicYearId: outcome === 'graduated' ? null : year.id,
      sectionId: section?.id ?? null, reason,
      overrideReason: overrideReason ?? null
    });
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
  constructor(knex, privateDocumentsDir, sensitiveDataKey = '') {
    this.db = knex;
    this.mode = 'mysql';
    this.loginFailures = new Map();
    this.privateDocumentsDir = path.resolve(privateDocumentsDir);
    this.sensitiveDataKey = sensitiveDataKey;
  }


  async assertStudentCapacity(organizationId, additional = 1, query = this.db) {
    const subscription = await query('organization_subscriptions as os')
      .join('subscription_plans as sp', 'sp.id', 'os.plan_id')
      .where('os.organization_id', organizationId).orderBy('os.created_at', 'desc')
      .forUpdate().select('sp.student_limit').first();
    if (!subscription || subscription.student_limit == null) return;
    const result = await query('students as s')
      .join('campuses as c', 'c.id', 's.campus_id')
      .where('c.organization_id', organizationId).whereNull('s.archived_at')
      .count({ total: 's.id' }).first();
    if (Number(result.total) + additional > Number(subscription.student_limit)) {
      throw planLimitError('student', Number(subscription.student_limit));
    }
  }





















  async listStudents(campusId) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereNull('archived_at')
      .orderBy('created_at', 'desc').limit(250);
    const placements = rows.length ? await this.db('enrolments as e')
      .join('sections as s', 's.id', 'e.section_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .whereIn('e.student_id', rows.map((row) => row.id))
      .where({ 'e.status': 'active', 'y.status': 'active', 's.campus_id': campusId })
      .select('e.student_id', 's.id as section_id', 's.grade_level_id', 's.stream') : [];
    const placementByStudent = new Map(placements.map((row) => [row.student_id, row]));
    return rows.map((row) => mapStudent({ ...row, ...(placementByStudent.get(row.id) ?? {}) }));
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
      const credentials = await this.db.transaction(async (trx) => {
        await this.assertStudentCapacity(actor.orgId, 1, trx);
        const generated = await generateStudentCredentials(data, async (username) =>
          Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')));
        const userId = randomUUID();
        await trx('users').insert({
          id: userId, organization_id: actor.orgId, name: studentName(data),
          username: generated.username, password_hash: generated.passwordHash,
          role: 'student', must_change_password: true, is_active: true
        });
        await trx('user_campuses').insert({
          user_id: userId, campus_id: actor.activeCampusId, is_active: true
        });
        await trx('students').insert({
          id, campus_id: actor.activeCampusId, student_no: data.studentNo,
          user_id: userId, status: 'enrolled',
          given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
          grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
          father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
          gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
          guardian_phone: data.guardianPhone ?? null, previous_school: data.previousSchool ?? null,
          section_name: data.sectionName ?? null
        });
        await trx('enrolments').insert({
          id: randomUUID(), student_id: id, academic_year_id: placement.academic_year_id,
          section_id: placement.section_id, status: 'active', enrolled_on: new Date()
        });
        await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null,
          { studentNo: data.studentNo, sectionName: data.sectionName, fields: Object.keys(data) }));
        await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
          studentId: id, username: generated.username
        }));
        return {
          username: generated.username, temporaryPassword: generated.temporaryPassword,
          studentName: generated.studentName
        };
      });
      return {
        student: { id, ...data, campusId: actor.activeCampusId, status: 'enrolled', hasPortalAccount: true },
        credentials
      };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && /student_no/i.test(error.message ?? '')) {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus.';
      }
      throw error;
    }
    return { id, ...data, campusId: actor.activeCampusId, status: 'enrolled' };
  }
  async previewStudentImport(rows, actor) {
    const [sections, studentRows] = await Promise.all([
      this.db('sections as s')
        .join('academic_years as y', 'y.id', 's.academic_year_id')
        .where({ 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
        .select('s.id', 's.name'),
      this.db('students').where({ campus_id: actor.activeCampusId })
        .whereNull('archived_at').select('*')
    ]);
    return studentImportReports(rows, sections, studentRows.map(mapStudent));
  }
  async importStudents(rows, actor) {
    try {
      return await this.db.transaction(async (trx) => {
        const [sections, studentRows] = await Promise.all([
          trx('sections as s')
            .join('academic_years as y', 'y.id', 's.academic_year_id')
            .where({ 's.campus_id': actor.activeCampusId, 'y.status': 'active' })
            .select('s.id', 's.name', 's.academic_year_id'),
          trx('students').where({ campus_id: actor.activeCampusId })
            .whereNull('archived_at').forUpdate().select('*')
        ]);
        const reports = studentImportReports(rows, sections, studentRows.map(mapStudent));
        const eligibleRows = rows.filter((row) =>
          reports.find((report) => report.rowNumber === row.rowNumber)?.eligible);
        await this.assertStudentCapacity(actor.orgId, eligibleRows.length, trx);
        const sectionByName = new Map(sections.map((section) => [
          normalizeImportValue(section.name), section
        ]));
        const generatedRows = await Promise.all(eligibleRows.map(async ({ rowNumber, data }) => ({
          rowNumber, data, generated: await generateStudentCredentials(data, async (username) =>
            Boolean(await trx('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first('id')))
        })));
        const credentials = [];
        for (const { rowNumber, data, generated } of generatedRows) {
          const section = sectionByName.get(normalizeImportValue(data.sectionName));
          const id = randomUUID();
          const userId = randomUUID();
          await trx('users').insert({
            id: userId, organization_id: actor.orgId, name: studentName(data),
            username: generated.username, password_hash: generated.passwordHash,
            role: 'student', must_change_password: true, is_active: true
          });
          await trx('user_campuses').insert({
            user_id: userId, campus_id: actor.activeCampusId, is_active: true
          });
          await trx('students').insert({
            id, campus_id: actor.activeCampusId, student_no: data.studentNo,
            user_id: userId, status: 'enrolled',
            given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
            grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
            father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
            gender: data.gender, date_of_birth: data.dateOfBirth ?? null,
            guardian_phone: data.guardianPhone ?? null, previous_school: data.previousSchool ?? null,
            section_name: data.sectionName
          });
          await trx('enrolments').insert({
            id: randomUUID(), student_id: id, academic_year_id: section.academic_year_id,
            section_id: section.id, status: 'active', enrolled_on: addisDate()
          });
          await trx('audit_log').insert(auditRow(actor, 'student.created', 'student', id, null, {
            studentNo: data.studentNo, sectionName: data.sectionName, fields: Object.keys(data)
          }));
          await trx('audit_log').insert(auditRow(actor, 'student.account_created', 'user', userId, null, {
            studentId: id, username: generated.username
          }));
          credentials.push({
            rowNumber, studentNo: data.studentNo, studentName: generated.studentName,
            username: generated.username, temporaryPassword: generated.temporaryPassword
          });
        }
        return { reports, createdCount: credentials.length, credentials };
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' && /student_no/i.test(error.message ?? '')) {
        error.code = 'STUDENT_NO_CONFLICT';
        error.message = 'Student number is already in use at this campus; no import rows were saved.';
      }
      throw error;
    }
  }
  async hasStudents(campusId, ids) {
    const rows = await this.db('students').where({ campus_id: campusId }).whereIn('id', ids).count({ total: '*' }).first();
    return Number(rows.total) === ids.length;
  }

  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    if (accessible.size === 0) return [];
    const rows = await this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .join('sections as s', 's.id', 'e.section_id')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .where({ 'y.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*', 's.id as section_id', 's.grade_level_id', 's.stream')
      .distinct().orderBy('st.created_at', 'desc').limit(250);
    return rows.map(mapStudent).map((student) => studentForActor(student, actor));
  }
  async updateStudentProfile(studentId, data, actor) {
    const fields = {
      givenNameAm: 'given_name_am', fatherNameAm: 'father_name_am', grandfatherNameAm: 'grandfather_name_am',
      givenNameEn: 'given_name_en', fatherNameEn: 'father_name_en', grandfatherNameEn: 'grandfather_name_en',
      gender: 'gender', dateOfBirth: 'date_of_birth', guardianPhone: 'guardian_phone',
      previousSchool: 'previous_school'
    };
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first();
      if (!student) return null;
      const updates = Object.fromEntries(Object.entries(data).map(([key, value]) => [fields[key], value]));
      await trx('students').where({ id: studentId, campus_id: actor.activeCampusId }).update(updates);
      await trx('audit_log').insert(auditRow(actor, 'student.profile_updated', 'student', studentId,
        null, { fields: Object.keys(data) }));
      return mapStudent({ ...student, ...updates });
    });
  }
  async getStudentSensitiveData(studentId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at')
        .select('id_number_enc', 'health_notes_enc', 'special_needs_enc', 'allergies_enc').first();
      if (!student) return null;
      const data = {
        idNumber: decryptSensitiveValue(student.id_number_enc, this.sensitiveDataKey),
        healthNotes: decryptSensitiveValue(student.health_notes_enc, this.sensitiveDataKey),
        specialNeeds: decryptSensitiveValue(student.special_needs_enc, this.sensitiveDataKey),
        allergies: decryptSensitiveValue(student.allergies_enc, this.sensitiveDataKey)
      };
      await trx('audit_log').insert(auditRow(actor, 'student.sensitive_data_viewed', 'student', studentId, null, {
        fields: Object.keys(data)
      }));
      return data;
    });
  }
  async updateStudentSensitiveData(studentId, data, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').select('id').first();
      if (!student) return null;
      const updates = {};
      if (Object.hasOwn(data, 'idNumber')) {
        updates.id_number_enc = encryptSensitiveValue(data.idNumber, this.sensitiveDataKey);
        updates.id_number_hash = hashSensitiveIdentifier(data.idNumber, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'healthNotes')) {
        updates.health_notes_enc = encryptSensitiveValue(data.healthNotes, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'specialNeeds')) {
        updates.special_needs_enc = encryptSensitiveValue(data.specialNeeds, this.sensitiveDataKey);
      }
      if (Object.hasOwn(data, 'allergies')) {
        updates.allergies_enc = encryptSensitiveValue(data.allergies, this.sensitiveDataKey);
      }
      await trx('students').where({ id: studentId, campus_id: actor.activeCampusId }).update(updates);
      await trx('audit_log').insert(auditRow(actor, 'student.sensitive_data_updated', 'student', studentId, null, {
        fields: Object.keys(data)
      }));
      const row = await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
        .select('id_number_enc', 'health_notes_enc', 'special_needs_enc', 'allergies_enc').first();
      return {
        idNumber: decryptSensitiveValue(row.id_number_enc, this.sensitiveDataKey),
        healthNotes: decryptSensitiveValue(row.health_notes_enc, this.sensitiveDataKey),
        specialNeeds: decryptSensitiveValue(row.special_needs_enc, this.sensitiveDataKey),
        allergies: decryptSensitiveValue(row.allergies_enc, this.sensitiveDataKey)
      };
    });
  }
  async listStudentEmergencyContacts(studentId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      const rows = await trx('student_emergency_contacts').where({
        student_id: studentId, campus_id: actor.activeCampusId
      }).orderBy('priority').orderBy('created_at');
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contacts_viewed',
        'student', studentId, null, { count: rows.length }));
      return rows.map((row) => ({
        id: row.id, studentId, name: decryptSensitiveValue(row.contact_name_enc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(row.phone_enc, this.sensitiveDataKey),
        relationship: row.relationship, priority: row.priority, createdAt: row.created_at
      }));
    });
  }
  async addStudentEmergencyContact(studentId, data, actor) {
    const id = randomUUID();
    const contactNameEnc = encryptSensitiveValue(data.name, this.sensitiveDataKey);
    const phoneEnc = encryptSensitiveValue(data.phone, this.sensitiveDataKey);
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      await trx('student_emergency_contacts').insert({
        id, campus_id: actor.activeCampusId, student_id: studentId,
        contact_name_enc: contactNameEnc, phone_enc: phoneEnc,
        relationship: data.relationship, priority: data.priority, created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contact_added',
        'student_emergency_contact', id, null, {
          studentId, fields: ['name', 'phone', 'relationship', 'priority'], priority: data.priority
        }));
      const row = await trx('student_emergency_contacts').where({ id }).first();
      return {
        id, studentId, name: decryptSensitiveValue(row.contact_name_enc, this.sensitiveDataKey),
        phone: decryptSensitiveValue(row.phone_enc, this.sensitiveDataKey),
        relationship: row.relationship, priority: row.priority, createdAt: row.created_at
      };
    });
  }
  async removeStudentEmergencyContact(studentId, contactId, actor) {
    return this.db.transaction(async (trx) => {
      const contact = await trx('student_emergency_contacts').where({
        id: contactId, student_id: studentId, campus_id: actor.activeCampusId
      }).first('id');
      if (!contact) return false;
      await trx('student_emergency_contacts').where({ id: contactId }).delete();
      await trx('audit_log').insert(auditRow(actor, 'student.emergency_contact_removed',
        'student_emergency_contact', contactId, null, { studentId }));
      return true;
    });
  }
  async listStudentGuardians(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_guardians as sg')
      .join('guardians as g', 'g.id', 'sg.guardian_id')
      .where({ 'sg.student_id': studentId, 'g.organization_id': actor.orgId })
      .select(
        'g.id', 'g.given_name_am', 'g.father_name_am', 'g.grandfather_name_am',
        'g.given_name_en', 'g.father_name_en', 'g.grandfather_name_en',
        'g.phone', 'g.email', 'g.user_id', 'sg.relationship', 'sg.is_primary', 'sg.is_verified',
        'sg.can_view_results', 'sg.can_view_fees'
      );
    return rows.map(mapStudentGuardian);
  }
  async listStudentCommendations(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_commendations').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('recorded_on', 'desc').orderBy('created_at', 'desc');
    return rows.map(mapStudentCommendation);
  }
  async createStudentCommendation(studentId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      await trx('student_commendations').insert({
        id, campus_id: actor.activeCampusId, student_id: studentId,
        recorded_on: data.recordedOn, title_en: data.titleEn, title_am: data.titleAm,
        description_en: data.descriptionEn, description_am: data.descriptionAm,
        created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.commendation.created',
        'student_commendation', id, null, {
          studentId, recordedOn: data.recordedOn, titleEn: data.titleEn, titleAm: data.titleAm
        }));
      return mapStudentCommendation(await trx('student_commendations').where({ id }).first());
    });
  }
  async addStudentGuardian(studentId, data, actor) {
    const guardianId = randomUUID();
    await this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first('id');
      if (!student) {
        const error = new Error('Student is outside the active campus.');
        error.code = 'CAMPUS_SCOPE_VIOLATION';
        throw error;
      }
      if (data.isPrimary) {
        await trx('student_guardians').where({ student_id: studentId }).update({ is_primary: false });
      }
      await trx('guardians').insert({
        id: guardianId, organization_id: actor.orgId,
        given_name_am: data.givenNameAm, father_name_am: data.fatherNameAm,
        grandfather_name_am: data.grandfatherNameAm, given_name_en: data.givenNameEn,
        father_name_en: data.fatherNameEn, grandfather_name_en: data.grandfatherNameEn,
        phone: data.phone, email: data.email ?? null
      });
      await trx('student_guardians').insert({
        student_id: studentId, guardian_id: guardianId, relationship: data.relationship,
        is_primary: data.isPrimary, is_verified: false, can_view_results: false, can_view_fees: false
      });
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_linked', 'student', studentId,
        null, { guardianId, relationship: data.relationship, isPrimary: data.isPrimary }));
    });
    return {
      id: guardianId, ...data, email: data.email ?? null, isVerified: false,
      canViewResults: false, canViewFees: false
    };
  }
  async removeStudentGuardian(studentId, guardianId, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return false;
      const link = await trx('student_guardians as sg')
        .join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': studentId, 'sg.guardian_id': guardianId,
          'g.organization_id': actor.orgId
        }).first('sg.relationship');
      if (!link) return false;
      await trx('student_guardians').where({ student_id: studentId, guardian_id: guardianId }).delete();
      await trx('audit_log').insert(auditRow(actor, 'student.guardian_unlinked', 'student', studentId,
        null, { guardianId, relationship: link.relationship }));
      return true;
    });
  }

  async listStudentsFor(actor) {
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible === null) return (await this.listStudents(actor.activeCampusId)).map((student) => studentForActor(student, actor));
    if (accessible.size === 0) return [];
    const query = this.db('students as st')
      .join('enrolments as e', 'e.student_id', 'st.id')
      .where({ 'st.campus_id': actor.activeCampusId, 'e.status': 'active' })
      .whereNull('st.archived_at')
      .whereIn('e.section_id', [...accessible])
      .select('st.*').distinct().orderBy('st.created_at', 'desc').limit(250);
    return (await query).map(mapStudent).map((student) => studentForActor(student, actor));
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
  async storeStudentDocument(studentId, documentType, originalName, mimeType, content, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (!isValidDocumentContent(mimeType, content) ||
      (documentType === 'photo' && !['image/jpeg', 'image/png'].includes(mimeType))) {
      throw invalidDocument('The student document content does not match its declared file type.');
    }
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, student_id: studentId, document_type: documentType,
      original_name: safeFilename(originalName), mime_type: mimeType, size_bytes: content.length,
      storage_key: randomUUID(), sha256: createHash('sha256').update(content).digest('hex'),
      uploaded_by: actor.sub
    };
    const filePath = path.join(this.privateDocumentsDir, row.storage_key);
    await mkdir(this.privateDocumentsDir, { recursive: true });
    await writeFile(filePath, content, { flag: 'wx' });
    try {
      await this.db.transaction(async (trx) => {
        await trx('student_documents').insert(row);
        await trx('audit_log').insert(auditRow(actor, 'student.document_uploaded',
          'student_document', id, null, {
            studentId, documentType, sizeBytes: content.length, sha256: row.sha256
          }));
      });
    } catch (error) {
      try {
        await unlink(filePath);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Student document metadata write and private-file cleanup both failed.');
      }
      throw error;
    }
    return mapStudentDocument(row);
  }
  async listStudentDocuments(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_documents').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    await this.appendAudit(actor, 'student.documents_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map(mapStudentDocument);
  }
  async getStudentDocument(studentId, documentId, actor) {
    const row = await this.db('student_documents as d')
      .join('students as s', 's.id', 'd.student_id')
      .where({
        'd.id': documentId, 'd.student_id': studentId,
        'd.campus_id': actor.activeCampusId, 's.campus_id': actor.activeCampusId
      }).whereNull('s.archived_at').select('d.*').first();
    if (!row) return null;
    await this.appendAudit(actor, 'student.document_downloaded', 'student_document', documentId, null, { studentId });
    const filePath = path.join(this.privateDocumentsDir, path.basename(row.storage_key));
    return { document: mapStudentDocument(row), content: await readFile(filePath) };
  }
  async createStudentTransferPackage(studentId, data, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const consent = await this.db('student_documents').where({
      id: data.consentDocumentId, student_id: studentId,
      campus_id: actor.activeCampusId, document_type: 'transfer_consent'
    }).first('id');
    if (!consent) throw setupConflict('Upload the guardian-signed transfer consent document before requesting approval.');
    const id = randomUUID();
    const row = {
      id, campus_id: actor.activeCampusId, student_id: studentId,
      recipient_school: data.recipientSchool, guardian_name: data.guardianName,
      guardian_relationship: data.guardianRelationship, consent_recorded_on: data.consentRecordedOn,
      consent_document_id: consent.id, status: 'pending', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      await trx('student_transfer_packages').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'student.transfer_package_requested',
        'student_transfer_package', id, null, {
          studentId, recipientSchool: row.recipient_school, consentRecordedOn: row.consent_recorded_on
        }));
    });
    return mapStudentTransferPackage(row);
  }
  async listStudentTransferPackages(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const rows = await this.db('student_transfer_packages').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return rows.map(mapStudentTransferPackage);
  }
  async approveStudentTransferPackage(packageId, tokenHash, actor) {
    return this.db.transaction(async (trx) => {
      const item = await trx('student_transfer_packages').where({
        id: packageId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!item) return null;
      if (!['pending', 'approved'].includes(item.status)) throw setupConflict('Only pending or approved transfer packages can receive a transfer link.');
      const expiresAt = new Date(Date.now() + 72 * 60 * 60_000);
      await trx('student_transfer_packages').where({ id: packageId }).update({
        status: 'approved', share_token_hash: tokenHash, expires_at: expiresAt,
        approved_by: actor.sub, approved_at: new Date()
      });
      await trx('audit_log').insert(auditRow(actor,
        item.status === 'pending' ? 'student.transfer_package_approved' : 'student.transfer_link_reissued',
        'student_transfer_package', packageId, { status: item.status }, {
          status: 'approved', expiresAt: expiresAt.toISOString()
        }));
      return mapStudentTransferPackage({
        ...item, status: 'approved', share_token_hash: tokenHash,
        expires_at: expiresAt, approved_by: actor.sub, approved_at: new Date()
      });
    });
  }
  async getStudentTransferPackageByTokenHash(tokenHash) {
    return this.db.transaction(async (trx) => {
      const item = await trx('student_transfer_packages as p')
        .join('students as s', 's.id', 'p.student_id')
        .join('campuses as c', 'c.id', 'p.campus_id')
        .join('organizations as o', 'o.id', 'c.organization_id')
        .where({ 'p.share_token_hash': tokenHash, 'p.status': 'approved' })
        .where('p.expires_at', '>', new Date())
        .whereNull('s.archived_at')
        .select('p.*', 'c.name as source_campus_name', 'o.name as source_school_name',
          's.student_no', 's.given_name_am', 's.father_name_am', 's.grandfather_name_am',
          's.given_name_en', 's.father_name_en', 's.grandfather_name_en',
          's.gender', 's.date_of_birth', 's.previous_school').first();
      if (!item) return null;
      const historyRows = await trx('enrolments as e')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .join('sections as section', 'section.id', 'e.section_id')
        .join('grade_levels as grade', 'grade.id', 'section.grade_level_id')
        .where({ 'e.student_id': item.student_id, 'y.campus_id': item.campus_id })
        .orderBy('y.start_date')
        .select('y.label_ec as academicYear', 'grade.name_en as grade',
          'section.name as section', 'e.status', 'e.outcome');
      return {
        recipientSchool: item.recipient_school,
        sourceSchool: item.source_school_name || item.source_campus_name,
        student: {
          studentNo: item.student_no, givenNameAm: item.given_name_am,
          fatherNameAm: item.father_name_am, grandfatherNameAm: item.grandfather_name_am,
          givenNameEn: item.given_name_en, fatherNameEn: item.father_name_en,
          grandfatherNameEn: item.grandfather_name_en, gender: item.gender,
          dateOfBirth: item.date_of_birth ? String(item.date_of_birth).slice(0, 10) : null,
          previousSchool: item.previous_school
        },
        guardianConsent: {
          guardianName: item.guardian_name, relationship: item.guardian_relationship,
          recordedOn: String(item.consent_recorded_on).slice(0, 10)
        },
        academicHistory: historyRows
      };
    });
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
  async listStudentEnrollmentHistory(studentId, actor) {
    const student = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!student) return null;
    const accessible = await this.accessibleSectionIds(actor);
    if (accessible && !await this.hasStudentsInSections(actor.activeCampusId, [...accessible], [studentId])) {
      throw campusScopeError('Teacher is not assigned to this student’s active section.');
    }
    const rows = await this.db('enrolments as e')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .join('sections as s', 's.id', 'e.section_id')
      .join('grade_levels as g', 'g.id', 's.grade_level_id')
      .where({ 'e.student_id': studentId, 's.campus_id': actor.activeCampusId, 'y.campus_id': actor.activeCampusId })
      .orderBy('y.start_date', 'desc')
      .select('e.id', 'e.academic_year_id as academicYearId', 'y.label_ec as academicYear',
        'g.id as gradeLevelId', 'g.name_en as gradeNameEn', 'g.name_am as gradeNameAm',
        's.id as sectionId', 's.name as sectionName', 'e.status', 'e.enrolled_on as enrolledOn',
        'e.left_on as leftOn', 'e.outcome');
    return rows.map((row) => ({
      ...row,
      enrolledOn: row.enrolledOn ? String(row.enrolledOn).slice(0, 10) : null,
      leftOn: row.leftOn ? String(row.leftOn).slice(0, 10) : null
    }));
  }
  async transferStudentSection(studentId, { sectionId, reason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId, status: 'enrolled'
      }).whereNull('archived_at').forUpdate().first();
      if (!student) {
        const exists = await trx('students').where({
          id: studentId, campus_id: actor.activeCampusId
        }).whereNull('archived_at').first('id');
        if (exists) throw setupConflict('Only enrolled students can transfer sections.');
        return null;
      }
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).first('id');
      const current = year && await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id, status: 'active'
      }).forUpdate().first();
      const destination = year && await trx('sections').where({
        id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id, is_active: true
      }).forUpdate().first();
      if (!year || !current || !destination) {
        throw campusScopeError('Select a section in the active academic year at this campus.');
      }
      if (current.section_id === destination.id) throw setupConflict('Student is already assigned to this section.');
      if (destination.capacity != null) {
        const total = await trx('enrolments').where({
          section_id: destination.id, academic_year_id: year.id, status: 'active'
        }).count({ total: '*' }).first();
        if (Number(total.total) >= Number(destination.capacity)) throw setupConflict('The selected section has reached capacity.');
      }
      await trx('enrolments').where({ id: current.id }).update({ section_id: destination.id });
      await trx('students').where({ id: studentId }).update({ section_name: destination.name });
      const transferId = randomUUID();
      await trx('student_section_transfers').insert({
        id: transferId, campus_id: actor.activeCampusId, student_id: studentId,
        academic_year_id: year.id, from_section_id: current.section_id,
        to_section_id: destination.id, reason, recorded_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'student.section_transferred', 'student',
        studentId, { sectionId: current.section_id }, { sectionId: destination.id, reason }));
      return mapStudent({ ...student, section_name: destination.name });
    });
  }
  async listStudentSectionTransfers(studentId, actor) {
    const exists = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!exists) return null;
    const rows = await this.db('student_section_transfers as tr')
      .join('sections as source', 'source.id', 'tr.from_section_id')
      .join('sections as destination', 'destination.id', 'tr.to_section_id')
      .where({ 'tr.campus_id': actor.activeCampusId, 'tr.student_id': studentId })
      .orderBy('tr.created_at', 'desc')
      .select('tr.id', 'tr.student_id as studentId', 'tr.reason', 'tr.created_at as createdAt',
        'source.name as fromSection', 'destination.name as toSection');
    return rows;
  }
  async listStudentDisciplineRecords(studentId, actor) {
    const exists = await this.db('students').where({
      id: studentId, campus_id: actor.activeCampusId
    }).whereNull('archived_at').first('id');
    if (!exists) return null;
    const rows = await this.db('student_discipline_records').where({
      student_id: studentId, campus_id: actor.activeCampusId
    }).orderBy('recorded_on', 'desc').orderBy('created_at', 'desc');
    await this.appendAudit(actor, 'student.discipline_viewed', 'student', studentId, null, { count: rows.length });
    return rows.map((row) => mapStudentDisciplineRecord(row, this.sensitiveDataKey));
  }
  async createStudentDisciplineRecord(studentId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) return null;
      const row = {
        id, campus_id: actor.activeCampusId, student_id: studentId,
        recorded_on: data.recordedOn, category: data.category,
        details_enc: encryptSensitiveValue(data.details, this.sensitiveDataKey),
        action_taken_enc: encryptSensitiveValue(data.actionTaken ?? null, this.sensitiveDataKey),
        recorded_by: actor.sub
      };
      await trx('student_discipline_records').insert(row);
      await trx('audit_log').insert(auditRow(actor, 'student.discipline_recorded',
        'student_discipline_record', id, null, {
          studentId, recordedOn: data.recordedOn, category: data.category
        }));
      return mapStudentDisciplineRecord(row, this.sensitiveDataKey);
    });
  }
  async advanceStudent(studentId, { outcome, sectionId, reason, overrideReason }, actor) {
    return this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').forUpdate().first();
      if (!student) return null;
      if (student.status !== 'enrolled') {
        throw setupConflict('Only an enrolled student can progress to a new academic year.');
      }
      const year = await trx('academic_years').where({
        campus_id: actor.activeCampusId, status: 'active'
      }).forUpdate().first();
      if (!year) throw setupConflict('Activate the destination academic year before recording progression.');
      const currentEnrollment = await trx('enrolments').where({
        student_id: studentId, academic_year_id: year.id
      }).first('id');
      if (currentEnrollment) throw setupConflict('The student already has an enrolment in the active academic year.');
      const previous = await trx('enrolments as e')
        .join('academic_years as y', 'y.id', 'e.academic_year_id')
        .join('sections as s', 's.id', 'e.section_id')
        .join('grade_levels as g', 'g.id', 's.grade_level_id')
        .where({
          'e.student_id': studentId, 'e.status': 'completed',
          'y.campus_id': actor.activeCampusId, 'y.status': 'closed', 's.campus_id': actor.activeCampusId
        })
        .orderBy('y.end_date', 'desc')
        .forUpdate()
        .first('e.id', 'e.academic_year_id', 's.grade_level_id as source_grade_level_id',
          's.stream as source_stream', 'g.sort_order as source_sort_order');
      if (!previous) throw setupConflict('A completed enrolment from a closed academic year is required.');

      if (outcome === 'graduated' && Number(previous.source_sort_order) !== 12) {
        throw setupConflict('Only Grade 12 students can be recorded as graduates.');
      }

      let section = null;
      if (outcome !== 'graduated') {
        section = await trx('sections').where({
          id: sectionId, campus_id: actor.activeCampusId, academic_year_id: year.id
        }).forUpdate().first();
        if (!section) throw campusScopeError('Select a section in the active academic year at this campus.');
        const destinationGrade = await trx('grade_levels').where({
          id: section.grade_level_id, campus_id: actor.activeCampusId
        }).first('sort_order');
        const expectedOrder = Number(previous.source_sort_order) + (outcome === 'promoted' ? 1 : 0);
        if (!destinationGrade || Number(destinationGrade.sort_order) !== expectedOrder) {
          throw setupConflict(outcome === 'promoted'
            ? 'Promotion must advance exactly one grade.'
            : 'Repetition must keep the student in the same grade.');
        }
        if (outcome === 'promoted') {
          const eligibility = await this.evaluateStudentProgression(studentId, actor);
          const overrideAllowed = ['owner_director', 'principal', 'system_admin'].includes(actor.role) &&
            Boolean(overrideReason?.trim());
          if (eligibility.status !== 'eligible' && !overrideAllowed) {
            throw setupConflict(`${eligibility.reason} A principal must configure the rule/results or provide an audited override reason.`);
          }
        }
        if (section.capacity != null) {
          const count = await trx('enrolments').where({
            section_id: section.id, academic_year_id: year.id, status: 'active'
          }).count({ total: '*' }).first();
          if (Number(count.total) >= Number(section.capacity)) {
            throw setupConflict('The selected section has reached capacity.');
          }
        }
      }

      const before = { status: student.status, sectionName: student.section_name };
      await trx('enrolments').where({ id: previous.id }).update({ outcome });
      if (outcome === 'graduated') {
        await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
          .update({ status: 'graduated', section_name: null });
      } else {
        await trx('enrolments').insert({
          id: randomUUID(), student_id: studentId, academic_year_id: year.id,
          section_id: section.id, status: 'active', enrolled_on: addisDate()
        });
        await trx('students').where({ id: studentId, campus_id: actor.activeCampusId })
          .update({ section_name: section.name });
      }
      await trx('student_status_history').insert({
        id: randomUUID(), student_id: studentId, campus_id: actor.activeCampusId,
        status: outcome, reason, recorded_by: actor.sub
      });
      const after = {
        status: outcome === 'graduated' ? 'graduated' : 'enrolled',
        outcome, fromAcademicYearId: previous.academic_year_id,
        toAcademicYearId: outcome === 'graduated' ? null : year.id,
        sectionId: section?.id ?? null, reason,
        overrideReason: overrideReason ?? null
      };
      await trx('audit_log').insert(auditRow(actor, `student.${outcome}`, 'student', studentId, before, after));
      return mapStudent({
        ...student, status: after.status,
        section_name: outcome === 'graduated' ? null : section.name
      });
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
  academic: memoryAcademicBundle
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
  academic: mysqlAcademicBundle
}));































function studentForActor(student, actor) {
  const { userId, ...publicStudent } = student;
  const result = { ...publicStudent, hasPortalAccount: Boolean(userId) };
  if (['owner_director', 'principal', 'registrar', 'system_admin'].includes(actor.role)) return result;
  return { ...result, guardianPhone: null };
}

function mapStudentGuardian(row) {
  return {
    id: row.id,
    givenNameAm: row.given_name_am ?? row.givenNameAm,
    fatherNameAm: row.father_name_am ?? row.fatherNameAm,
    grandfatherNameAm: row.grandfather_name_am ?? row.grandfatherNameAm,
    givenNameEn: row.given_name_en ?? row.givenNameEn,
    fatherNameEn: row.father_name_en ?? row.fatherNameEn,
    grandfatherNameEn: row.grandfather_name_en ?? row.grandfatherNameEn,
    phone: row.phone,
    email: row.email ?? null,
    hasPortalAccount: Boolean(row.user_id ?? row.userId),
    relationship: row.relationship,
    isPrimary: Boolean(row.is_primary ?? row.isPrimary),
    isVerified: Boolean(row.is_verified ?? row.isVerified),
    canViewResults: Boolean(row.can_view_results ?? row.canViewResults),
    canViewFees: Boolean(row.can_view_fees ?? row.canViewFees)
  };
}

function mapStudentCommendation(row) {
  const recordedOn = row.recorded_on ?? row.recordedOn;
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    studentId: row.student_id ?? row.studentId,
    recordedOn: String(recordedOn).slice(0, 10),
    titleEn: row.title_en ?? row.titleEn, titleAm: row.title_am ?? row.titleAm,
    descriptionEn: row.description_en ?? row.descriptionEn,
    descriptionAm: row.description_am ?? row.descriptionAm,
    createdBy: row.created_by ?? row.createdBy,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
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

function mapStudentDocument(row) {
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    studentId: row.student_id ?? row.studentId,
    documentType: row.document_type ?? row.documentType,
    originalName: row.original_name ?? row.originalName,
    mimeType: row.mime_type ?? row.mimeType,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    sha256: row.sha256,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}

function mapStudentDisciplineRecord(row, key) {
  const recordedOn = row.recorded_on ?? row.recordedOn;
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, studentId: row.student_id ?? row.studentId,
    recordedOn: String(recordedOn).slice(0, 10), category: row.category,
    details: decryptSensitiveValue(row.details_enc ?? row.detailsEnc, key),
    actionTaken: decryptSensitiveValue(row.action_taken_enc ?? row.actionTakenEnc, key),
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt
  };
}

function mapStudentTransferPackage(row) {
  const expiresAt = row.expires_at ?? row.expiresAt;
  const createdAt = row.created_at ?? row.createdAt;
  return {
    id: row.id, studentId: row.student_id ?? row.studentId,
    recipientSchool: row.recipient_school ?? row.recipientSchool,
    guardianName: row.guardian_name ?? row.guardianName,
    guardianRelationship: row.guardian_relationship ?? row.guardianRelationship,
    consentRecordedOn: String(row.consent_recorded_on ?? row.consentRecordedOn).slice(0, 10),
    status: row.status,
    expiresAt: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt ?? null,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : createdAt ?? null
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
