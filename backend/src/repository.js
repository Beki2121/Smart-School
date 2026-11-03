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
import { memoryExamsBundle } from './repositories/memory/exams.repository.js';
import { mysqlExamsBundle } from './repositories/mysql/exams.repository.js';
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
import { memoryAdmissionsBundle } from './repositories/memory/admissions.repository.js';
import { mysqlAdmissionsBundle } from './repositories/mysql/admissions.repository.js';
import { memoryAuditBundle } from './repositories/memory/audit.repository.js';
import { mysqlAuditBundle } from './repositories/mysql/audit.repository.js';
import { memoryRolesBundle } from './repositories/memory/roles.repository.js';
import { mysqlRolesBundle } from './repositories/mysql/roles.repository.js';
import { examPermissionRoles } from '../migrations/202611030005_exams_permissions.js';
import { seededPermissionRoles } from '../migrations/202611020002_seed_role_permissions.js';
import {
  attendanceCorrectionConflict, attendanceCorrectionWindowOpen, buildAttendanceSummary
} from './repositories/attendance.mappers.js';
import { mapTermReportRevision } from './repositories/marks.mappers.js';
import {
  addisDate, auditRow, campusScopeError, now, planLimitError, scheduleConflict, setupConflict
} from './repositories/shared.js';
import { formatStaffName, mapStaff } from './repositories/staff.mappers.js';










export class MemoryRepository {
  constructor({ users, campuses, sections, academicYears, gradeLevels = [], subjects = [], staff = [], departments = [], sensitiveDataKey = '' }) {
    this.users = users;
    this.roles = [];
    const permissionSeeds = { ...seededPermissionRoles, ...examPermissionRoles };
    this.permissions = Object.keys(permissionSeeds).map((key) => ({ key, description: key }));
    this.rolePermissions = [];
    const roleIds = new Map();
    for (const roleKey of [...new Set(Object.values(permissionSeeds).flat())]) {
      const id = randomUUID();
      roleIds.set(roleKey, id);
      this.roles.push({
        id, organizationId: null, key: roleKey,
        name: roleKey.split('_').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' '),
        isSystem: true
      });
    }
    for (const [permissionKey, roleKeys] of Object.entries(permissionSeeds)) {
      for (const roleKey of roleKeys) {
        this.rolePermissions.push({ roleId: roleIds.get(roleKey), permissionKey });
      }
    }
    this.campuses = campuses;
    for (const campus of campuses) campus.admissionsPublicToken ??= randomBytes(32).toString('hex');
    this.organizations = [];
    this.subscriptionPlans = [{
      id: randomUUID(), code: 'starter', name: 'Starter', description: 'Initial private-school trial plan',
      monthlyPrice: 0, currencyCode: 'ETB', trialDays: 30, studentLimit: 100,
      staffLimit: 20, siteLimit: 1, billingCycle: 'monthly', maxUsers: null,
      storageLimitBytes: null, modules: [
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
        schoolCode: `SCH-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`,
        academicConfiguration: { calendarType: 'ethiopian', dateFormat: 'dd/MM/yyyy', defaultLocale: 'en' },
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
    this.subscriptionRefunds = [];
    this.globalSettings = {
      defaultLocale: 'en', currencyCode: 'ETB',
      dateFormat: 'dd/MM/yyyy', calendarType: 'ethiopian',
      smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '',
      smtpPasswordCiphertext: null, smtpFrom: 'noreply@smartschool.local'
    };
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
    this.subscriptionExpiryNotices = [];
    this.students = [];
    this.enrolments = [];
    this.studentSensitive = new Map();
    this.studentDocuments = [];
    this.studentSectionTransfers = [];
    this.studentDisciplineRecords = [];
    this.studentTransferPackages = [];
    this.sensitiveDataKey = sensitiveDataKey;
    this.attendance = [];
    this.examTypes = [];
    this.exams = [];
    this.examScheduleEntries = [];
    this.examInvigilators = [];
    this.examNotifications = [];
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
    this.authSessions = new Map();
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
      actorId: actor.sub, action, entityType, entityId,
      before: before == null ? before : structuredClone(before),
      after: after == null ? after : structuredClone(after),
      createdAt: now()
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

































  async close() { await this.db.destroy(); }
}

Object.assign(MemoryRepository.prototype, composeRepositoryBundles({
  communications: memoryCommunicationsBundle,
  staff: memoryStaffBundle,
  fees: memoryFeesBundle,
  attendance: memoryAttendanceBundle,
  marks: memoryMarksBundle,
  exams: memoryExamsBundle,
  timetable: memoryTimetableBundle,
  platform: memoryPlatformBundle,
  accounts: memoryAccountsBundle,
  roles: memoryRolesBundle,
  portal: memoryPortalBundle,
  academic: memoryAcademicBundle,
  students: memoryStudentsBundle,
  admissions: memoryAdmissionsBundle,
  audit: memoryAuditBundle
}));
Object.assign(MysqlRepository.prototype, composeRepositoryBundles({
  communications: mysqlCommunicationsBundle,
  staff: mysqlStaffBundle,
  fees: mysqlFeesBundle,
  attendance: mysqlAttendanceBundle,
  marks: mysqlMarksBundle,
  exams: mysqlExamsBundle,
  timetable: mysqlTimetableBundle,
  platform: mysqlPlatformBundle,
  accounts: mysqlAccountsBundle,
  roles: mysqlRolesBundle,
  portal: mysqlPortalBundle,
  academic: mysqlAcademicBundle,
  students: mysqlStudentsBundle,
  admissions: mysqlAdmissionsBundle,
  audit: mysqlAuditBundle
}));

























































































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
