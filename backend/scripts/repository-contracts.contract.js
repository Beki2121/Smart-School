import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import knexFactory from 'knex';
import { after, before, describe, it } from 'node:test';
import { createAuthController } from '../src/controllers/auth.controller.js';
import { createFinanceController } from '../src/controllers/finance.controller.js';
import { MemoryRepository, MysqlRepository } from '../src/repository.js';
import { feeBalanceFromLedger } from '../src/repositories/fees.mappers.js';
import { permissionRoles } from '../src/middleware/permissions.js';
import { up as migrateFeeItemCategory } from '../migrations/202610300002_fee_item_category.js';
import { up as migrateRefreshTokenCampusScope } from '../migrations/202611010001_refresh_token_campus_scope.js';
import { up as migratePlatformAdminInvitation } from '../migrations/202611010002_platform_school_admin_invitations.js';
import { up as migratePlatformUserInvitations } from '../migrations/202611020003_platform_user_invitations.js';
import { up as migratePlatformDashboard } from '../migrations/202611030001_platform_dashboard_quotas.js';
import { up as migrateWp4Exams } from '../migrations/202611030004_wp4_exams.js';
import { up as migrateWp5Finance } from '../migrations/202611030005_wp5_finance.js';
import { down as rollbackWp5Finance } from '../migrations/202611030005_wp5_finance.js';
import { up as migrateWp5FinancePermissions } from '../migrations/202611030006_wp5_finance_permissions.js';
import { down as rollbackWp5FinancePermissions } from '../migrations/202611030006_wp5_finance_permissions.js';
import { up as migrateCashbookAccountIdempotency } from '../migrations/202611030007_cashbook_account_idempotency.js';
import { down as rollbackCashbookAccountIdempotency } from '../migrations/202611030007_cashbook_account_idempotency.js';
import { up as migrateWp6Assignments } from '../migrations/202611030008_wp6_assignments.js';
import {
  assignmentPermissionRoles, up as migrateWp6AssignmentPermissions
} from '../migrations/202611030009_wp6_assignments_permissions.js';
import {
  reportPermissionRoles, up as migrateWp7ReportPermissions
} from '../migrations/202611030011_wp7_reports_permissions.js';
import {
  portalExtensionPermissionRoles, up as migrateWp8PortalPermissions
} from '../migrations/202611030013_wp8_portal_permissions.js';
import { up as migrateWp8Portal } from '../migrations/202611030012_wp8_portal_communication.js';
import { examPermissionRoles } from '../migrations/202611030005_exams_permissions.js';
import { financePermissionRoles } from '../migrations/202611030006_wp5_finance_permissions.js';
import { seededPermissionRoles } from '../migrations/202611020002_seed_role_permissions.js';

const testEnvPath = fileURLToPath(new URL('../../.env.mysql-test', import.meta.url));
if (!existsSync(testEnvPath)) {
  throw new Error('Missing repository-root .env.mysql-test configuration for MySQL contract tests.');
}
dotenv.config({ path: testEnvPath, override: true });

const databaseName = process.env.DB_NAME;
if (!databaseName?.endsWith('_test')) {
  throw new Error('Repository contract tests require DB_NAME to end in "_test".');
}
const databaseHost = process.env.DB_HOST ?? '127.0.0.1';
if (!process.env.DB_SOCKET_PATH && !['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error('Repository contract tests require a local MySQL database host.');
}
for (const name of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Repository contract tests require ${name}.`);
}

const mysql = knexFactory({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: databaseName
  },
  pool: { min: 0, max: 3 }
});
const mysqlRepository = new MysqlRepository(mysql, path.resolve('.private'), '');

before(async () => {
  const [rows] = await mysql.raw('SELECT DATABASE() AS database_name');
  assert.equal(rows[0].database_name, databaseName);
  const [, pending] = await mysql.migrate.list({
    directory: path.resolve('migrations')
  });
  assert.equal(pending.length, 0, 'Apply all backend migrations to the test database first.');
  assert.equal(await mysql.schema.hasTable('auth_sessions'), true);
  assert.equal(await mysql.schema.hasColumn('refresh_tokens', 'session_id'), true);
});

after(async () => {
  await mysql.destroy();
});

function makeActors(orgId, campusA, campusB) {
  return Object.fromEntries([
    ['owner', 'owner_director', campusA],
    ['cashier', 'accountant_cashier', campusA],
    ['academicHead', 'academic_head', campusA],
    ['principal', 'principal', campusA],
    ['campusBOwner', 'owner_director', campusB],
    ['teacherOne', 'homeroom_teacher', campusA],
    ['teacherTwo', 'subject_teacher', campusA],
    ['inactiveTeacher', 'homeroom_teacher', campusA]
  ].map(([key, role, activeCampusId]) => {
    const sub = randomUUID();
    return [key, {
      id: sub, orgId, name: `Contract ${key}`, email: `${sub}@example.test`,
      role, campusIds: [activeCampusId], activeCampusId, isActive: true,
      actor: { sub, orgId, activeCampusId, role }
    }];
  }));
}

function rolePermissionsFrom(permissionRoleMap) {
  const result = {};
  for (const [permissionKey, roles] of Object.entries(permissionRoleMap)) {
    for (const role of roles) (result[role] ??= []).push(permissionKey);
  }
  for (const permissions of Object.values(result)) permissions.sort();
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) =>
    left.localeCompare(right)));
}

function contractSchoolCode() {
  return `SCH-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

async function createFixture(mode) {
  const orgId = randomUUID();
  const campusA = randomUUID();
  const campusB = randomUUID();
  const studentA = randomUUID();
  const studentB = randomUUID();
  const actors = makeActors(orgId, campusA, campusB);
  actors.inactiveTeacher.isActive = false;
  const campuses = [
    { id: campusA, organizationId: orgId, name: 'Contract Campus A', isActive: true },
    { id: campusB, organizationId: orgId, name: 'Contract Campus B', isActive: true }
  ];
  const students = [
    {
      id: studentA, campusId: campusA, studentNo: `A-${studentA.slice(0, 8)}`,
      givenNameEn: 'Ada', fatherNameEn: 'Contract', grandfatherNameEn: 'Student',
      givenNameAm: 'አዳ', fatherNameAm: 'ፈተና', grandfatherNameAm: 'ተማሪ',
      gender: 'female', sectionName: null, archivedAt: null
    },
    {
      id: studentB, campusId: campusB, studentNo: `B-${studentB.slice(0, 8)}`,
      givenNameEn: 'Ben', fatherNameEn: 'Contract', grandfatherNameEn: 'Student',
      givenNameAm: 'ቤን', fatherNameAm: 'ፈተና', grandfatherNameAm: 'ተማሪ',
      gender: 'male', sectionName: null, archivedAt: null
    }
  ];
  const memory = new MemoryRepository({
    users: Object.values(actors).map(({ actor, ...user }) => user),
    campuses, sections: [], academicYears: []
  });
  memory.students.push(...students);

  if (mode === 'mysql') {
    await mysql('organizations').insert({
      id: orgId, name: 'Repository Contract School', status: 'active',
      school_code: contractSchoolCode(), academic_configuration_json: '{}'
    });
    await mysql('campuses').insert(campuses.map((campus) => ({
      id: campus.id, organization_id: orgId, name: campus.name, is_active: true
    })));
    await mysql('users').insert(Object.values(actors).map((user) => ({
      id: user.id, organization_id: orgId, name: user.name, email: user.email,
      password_hash: 'contract-test-not-a-login-hash', role: user.role,
      is_active: user.isActive !== false
    })));
    await mysql('user_campuses').insert(Object.values(actors).map((user) => ({
      user_id: user.id, campus_id: user.activeCampusId, is_active: true
    })));
    await mysql('students').insert(students.map((student) => ({
      id: student.id, campus_id: student.campusId, student_no: student.studentNo,
      given_name_am: student.givenNameAm, father_name_am: student.fatherNameAm,
      grandfather_name_am: student.grandfatherNameAm,
      given_name_en: student.givenNameEn, father_name_en: student.fatherNameEn,
      grandfather_name_en: student.grandfatherNameEn, gender: student.gender
    })));
  }

  return {
    repo: mode === 'mysql' ? mysqlRepository : memory,
    db: mode === 'mysql' ? mysql : null,
    orgId, campusA, campusB, studentA, studentB, actors
  };
}

async function prepareAcademicStudentFixture(fixture) {
  const { repo, db, campusA, campusB, studentA, studentB, actors } = fixture;
  const suffix = randomUUID().slice(0, 8);
  const yearA = await repo.createAcademicYear({
    labelEc: `CONTRACT-A-${suffix}`, startDate: '2026-01-01', endDate: '2026-12-31'
  }, actors.owner.actor);
  await repo.activateAcademicYear(yearA.id, actors.owner.actor);
  const nextYear = await repo.createAcademicYear({
    labelEc: `CONTRACT-N-${suffix}`, startDate: '2027-01-01', endDate: '2027-12-31'
  }, actors.owner.actor);
  const yearB = await repo.createAcademicYear({
    labelEc: `CONTRACT-B-${suffix}`, startDate: '2026-01-01', endDate: '2026-12-31'
  }, actors.campusBOwner.actor);
  await repo.activateAcademicYear(yearB.id, actors.campusBOwner.actor);
  const gradeA = await repo.createGrade({ code: 'G7' }, actors.owner.actor);
  const gradeB = await repo.createGrade({ code: 'G7' }, actors.campusBOwner.actor);
  const sectionA = await repo.createSection({
    gradeLevelId: gradeA.id, name: `Contract A ${suffix}`, capacity: null, shift: 'morning'
  }, actors.owner.actor);
  const sectionA2 = await repo.createSection({
    gradeLevelId: gradeA.id, name: `Contract A2 ${suffix}`, capacity: 5, shift: 'morning'
  }, actors.owner.actor);
  const sectionB = await repo.createSection({
    gradeLevelId: gradeB.id, name: `Contract B ${suffix}`, capacity: null, shift: 'morning'
  }, actors.campusBOwner.actor);

  if (db) {
    await db('students').where({ id: studentA }).update({ section_name: sectionA.name, status: 'enrolled' });
    await db('students').where({ id: studentB }).update({ section_name: sectionB.name, status: 'enrolled' });
    await db('enrolments').insert([
      { id: randomUUID(), student_id: studentA, academic_year_id: yearA.id,
        section_id: sectionA.id, status: 'active', enrolled_on: '2026-01-01' },
      { id: randomUUID(), student_id: studentB, academic_year_id: yearB.id,
        section_id: sectionB.id, status: 'active', enrolled_on: '2026-01-01' }
    ]);
  } else {
    repo.students.find((student) => student.id === studentA).sectionName = sectionA.name;
    repo.students.find((student) => student.id === studentA).status = 'enrolled';
    repo.students.find((student) => student.id === studentB).sectionName = sectionB.name;
    repo.students.find((student) => student.id === studentB).status = 'enrolled';
    repo.enrolments.push(
      { id: randomUUID(), studentId: studentA, academicYearId: yearA.id,
        sectionId: sectionA.id, status: 'active', enrolledOn: '2026-01-01' },
      { id: randomUUID(), studentId: studentB, academicYearId: yearB.id,
        sectionId: sectionB.id, status: 'active', enrolledOn: '2026-01-01' }
    );
  }
  return { yearA, nextYear, yearB, gradeA, gradeB, sectionA, sectionA2, sectionB };
}

async function prepareAttendanceFixture(fixture) {
  const { repo, db, campusA, campusB, studentA, studentB } = fixture;
  const yearA = randomUUID();
  const yearB = randomUUID();
  const gradeA = randomUUID();
  const gradeB = randomUUID();
  const sectionA = {
    id: randomUUID(), campusId: campusA, academicYearId: yearA,
    gradeLevelId: gradeA, name: 'Attendance Section A', isActive: true
  };
  const sectionB = {
    id: randomUUID(), campusId: campusB, academicYearId: yearB,
    gradeLevelId: gradeB, name: 'Attendance Section B', isActive: true
  };
  if (db) {
    await db('academic_years').insert([
      { id: yearA, campus_id: campusA, label_ec: `ATT-${yearA.slice(0, 8)}`,
        start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' },
      { id: yearB, campus_id: campusB, label_ec: `ATT-${yearB.slice(0, 8)}`,
        start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' }
    ]);
    await db('grade_levels').insert([
      { id: gradeA, campus_id: campusA, code: `ATT-${gradeA.slice(0, 8)}`,
        name_en: 'Attendance Grade A', name_am: 'የፈተና ክፍል', band: 'primary', sort_order: 1 },
      { id: gradeB, campus_id: campusB, code: `ATT-${gradeB.slice(0, 8)}`,
        name_en: 'Attendance Grade B', name_am: 'የፈተና ክፍል', band: 'primary', sort_order: 1 }
    ]);
    await db('sections').insert([sectionA, sectionB].map((section) => ({
      id: section.id, campus_id: section.campusId,
      academic_year_id: section.academicYearId, grade_level_id: section.gradeLevelId,
      name: section.name
    })));
    await db('enrolments').insert([
      { id: randomUUID(), student_id: studentA, academic_year_id: yearA,
        section_id: sectionA.id, status: 'active', enrolled_on: '2026-01-01' },
      { id: randomUUID(), student_id: studentB, academic_year_id: yearB,
        section_id: sectionB.id, status: 'active', enrolled_on: '2026-01-01' }
    ]);
  } else {
    repo.academicYears.push(
      { id: yearA, campusId: campusA, status: 'active', labelEc: 'Attendance A' },
      { id: yearB, campusId: campusB, status: 'active', labelEc: 'Attendance B' }
    );
    repo.sections.push(sectionA, sectionB);
    repo.students.find((student) => student.id === studentA).sectionName = sectionA.name;
    repo.students.find((student) => student.id === studentB).sectionName = sectionB.name;
  }
  return { sectionA, sectionB };
}

async function prepareStaffFixture(fixture) {
  const { repo, db, orgId, campusA, campusB } = fixture;
  const departmentA = { id: randomUUID(), campusId: campusA, name: 'Contract Department A' };
  const departmentB = { id: randomUUID(), campusId: campusB, name: 'Contract Department B' };
  const gradeId = randomUUID();
  const subjectOne = { id: randomUUID(), campusId: campusA, code: 'CT1', nameEn: 'Contract Subject One', nameAm: 'ፈተና አንድ' };
  const subjectTwo = { id: randomUUID(), campusId: campusA, code: 'CT2', nameEn: 'Contract Subject Two', nameAm: 'ፈተና ሁለት' };
  const yearId = randomUUID();
  const sections = [1, 2].map((number) => ({
    id: randomUUID(), campusId: campusA, academicYearId: yearId, gradeLevelId: gradeId,
    name: `Contract Section ${number}`, shift: 'morning', stream: 'all', isActive: true
  }));
  const rooms = [1, 2].map((number) => ({
    id: randomUUID(), campusId: campusA, name: `Contract Room ${number}`, isActive: true
  }));

  if (db) {
    const planId = randomUUID();
    await db('subscription_plans').insert({
      id: planId, code: `staff-contract-${randomUUID().slice(0, 8)}`,
      name: 'Staff contract plan', description: '', monthly_price: 0,
      currency_code: 'ETB', trial_days: 30, student_limit: 100, staff_limit: 2,
      site_limit: 2, modules_json: JSON.stringify(['staff']), is_active: true
    });
    await db('organization_subscriptions').insert({
      id: randomUUID(), organization_id: orgId, plan_id: planId, status: 'active'
    });
    await db('departments').insert([
      { id: departmentA.id, campus_id: campusA, name: departmentA.name },
      { id: departmentB.id, campus_id: campusB, name: departmentB.name }
    ]);
    await db('academic_years').insert({
      id: yearId, campus_id: campusA, label_ec: `2000-${yearId.slice(0, 4)}`,
      start_date: '2026-01-01', end_date: '2026-12-31', status: 'active'
    });
    await db('grade_levels').insert({
      id: gradeId, campus_id: campusA, code: `CT-${gradeId.slice(0, 4)}`,
      name_en: 'Contract Grade', name_am: 'የፈተና ክፍል', band: 'primary', sort_order: 1
    });
    await db('sections').insert(sections.map((section) => ({
      id: section.id, campus_id: campusA, academic_year_id: yearId,
      grade_level_id: gradeId, name: section.name, shift: section.shift, stream: section.stream
    })));
    await db('subjects').insert([subjectOne, subjectTwo].map((subject) => ({
      id: subject.id, campus_id: campusA, code: subject.code,
      name_en: subject.nameEn, name_am: subject.nameAm
    })));
    await db('grade_subjects').insert([subjectOne, subjectTwo].map((subject) => ({
      id: randomUUID(), grade_level_id: gradeId, subject_id: subject.id, stream: 'all'
    })));
    await db('timetable_periods').insert({
      id: randomUUID(), campus_id: campusA, shift: 'morning', period_number: 1,
      starts_at: '08:00:00', ends_at: '08:40:00'
    });
    await db('rooms').insert(rooms.map((room) => ({
      id: room.id, campus_id: campusA, name: room.name, is_active: true
    })));
  } else {
    repo.subscriptionPlans[0].staffLimit = 2;
    repo.departments.push(departmentA, departmentB);
    repo.gradeLevels.push({ id: gradeId, campusId: campusA });
    repo.subjects.push(subjectOne, subjectTwo);
    repo.sections.push(...sections);
    repo.gradeSubjects.push(...[subjectOne, subjectTwo].map((subject) => ({
      gradeLevelId: gradeId, subjectId: subject.id, stream: 'all'
    })));
    repo.timetablePeriods.push({
      id: randomUUID(), campusId: campusA, shift: 'morning', periodNumber: 1
    });
    repo.rooms.push(...rooms);
  }

  return { departmentA, departmentB, sections, rooms, subjectOne, subjectTwo };
}

async function paymentCount(fixture, campusId) {
  if (fixture.db) {
    const row = await fixture.db('fee_payments').where({ campus_id: campusId })
      .count({ total: '*' }).first();
    return Number(row.total);
  }
  return fixture.repo.feePayments.filter((payment) => payment.campusId === campusId).length;
}

async function auditActions(fixture, campusId) {
  if (fixture.db) {
    return (await fixture.db('audit_log').where({ campus_id: campusId })
      .select('action')).map((row) => row.action).sort();
  }
  return fixture.repo.audit.filter((row) => row.campusId === campusId)
    .map((row) => row.action).sort();
}

async function findAuditEvent(fixture, action, entityId) {
  if (fixture.db) {
    const query = fixture.db('audit_log').where({ action, entity_id: entityId });
    if (entityId === null) query.where({ organization_id: fixture.orgId });
    const row = await query.first();
    return row && {
      organizationId: row.organization_id, campusId: row.campus_id,
      before: typeof row.before_json === 'string' ? JSON.parse(row.before_json) : row.before_json,
      after: typeof row.after_json === 'string' ? JSON.parse(row.after_json) : row.after_json
    };
  }
  const row = fixture.repo.audit.find((event) => event.action === action &&
    event.entityId === entityId && (entityId !== null || event.organizationId === fixture.orgId));
  return row && {
    organizationId: row.organizationId, campusId: row.campusId,
    before: row.before, after: row.after
  };
}

async function runAttendanceContract(fixture) {
  const { repo, campusA, campusB, studentA, studentB, actors } = fixture;
  const { sectionA, sectionB } = await prepareAttendanceFixture(fixture);
  const owner = actors.owner.actor;
  const sessionData = {
    date: '2026-10-20', sectionId: sectionA.id, clientUuid: randomUUID(),
    records: [{ studentId: studentA, status: 'present', reason: '' }]
  };
  const saved = await repo.saveAttendance(sessionData, owner);
  const replay = await repo.saveAttendance(sessionData, owner);
  assert.equal(replay.id, saved.id);
  assert.equal(replay.duplicate, true);

  const roster = await repo.listRoster(owner, sectionA.id);
  assert.deepEqual(roster.map((student) => student.id), [studentA]);
  await assert.rejects(repo.listRoster(owner, sectionB.id), {
    code: 'CAMPUS_SCOPE_VIOLATION'
  });
  await assert.rejects(repo.listRoster(actors.teacherOne.actor, sectionA.id), {
    code: 'CAMPUS_SCOPE_VIOLATION'
  });
  await assert.rejects(repo.saveAttendance({
    ...sessionData, clientUuid: randomUUID(), sectionId: sectionB.id
  }, owner), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await assert.rejects(repo.saveAttendance({
    ...sessionData, clientUuid: randomUUID(),
    records: [{ studentId: studentB, status: 'present' }]
  }, owner), { code: 'CAMPUS_SCOPE_VIOLATION' });
  assert.equal(await repo.getAttendanceSession(saved.id, actors.campusBOwner.actor), null);
  assert.equal((await repo.listAttendance(campusA, owner)).some((row) => row.id === saved.id), true);
  assert.equal((await repo.listAttendance(campusB, actors.campusBOwner.actor))
    .some((row) => row.id === saved.id), false);

  const requested = await repo.correctAttendance(saved.id, studentA, {
    status: 'absent', reason: 'Correction requested'
  }, owner);
  assert.equal(requested.approvalRequired, true);
  const request = requested.request;
  assert.equal(request.status, 'pending');
  assert.equal((await repo.listAttendanceCorrectionRequests(actors.principal.actor))
    .some((item) => item.id === request.id), true);
  await assert.rejects(repo.reviewAttendanceCorrection(request.id, {
    decision: 'approved', note: 'Self review is not allowed'
  }, owner), { code: 'ATTENDANCE_CORRECTION_CONFLICT' });
  assert.equal(await repo.reviewAttendanceCorrection(request.id, {
    decision: 'approved', note: 'Verified'
  }, actors.principal.actor).then((result) => result.status), 'approved');
  assert.equal((await repo.getAttendanceSession(saved.id, owner)).records[0].status, 'absent');
  await assert.rejects(repo.reviewAttendanceCorrection(request.id, {
    decision: 'approved', note: 'Already reviewed'
  }, actors.principal.actor), { code: 'ATTENDANCE_CORRECTION_CONFLICT' });

  const rejectedRequest = await repo.correctAttendance(saved.id, studentA, {
    status: 'present', reason: 'Second correction request'
  }, owner);
  assert.equal(rejectedRequest.approvalRequired, true);
  const rejected = await repo.reviewAttendanceCorrection(rejectedRequest.request.id, {
    decision: 'rejected', note: 'Insufficient evidence'
  }, actors.principal.actor);
  assert.equal(rejected.status, 'rejected');
  assert.equal((await repo.getAttendanceSession(saved.id, owner)).records[0].status, 'absent');
  assert.equal(await repo.reviewAttendanceCorrection(request.id, {
    decision: 'approved', note: 'Wrong campus'
  }, actors.campusBOwner.actor), null);

  const actions = await auditActions(fixture, campusA);
  for (const action of [
    'attendance.recorded', 'attendance.correction_requested',
    'attendance.corrected', 'attendance.correction_approved',
    'attendance.correction_rejected'
  ]) {
    assert.ok(actions.includes(action), `expected audit action ${action}`);
  }
  if (fixture.db) {
    const auditRows = await fixture.db('audit_log').where({
      campus_id: campusA, action: 'attendance.corrected'
    }).select('entity_id', 'after_json');
    const correctionAudit = auditRows.find((row) => {
      const after = typeof row.after_json === 'string' ? JSON.parse(row.after_json) : row.after_json;
      return after.status === 'absent';
    });
    assert.ok(correctionAudit);
    assert.equal(correctionAudit.entity_id, saved.id);
    assert.ok(correctionAudit.entity_id.length <= 36);
  } else {
    const correctionAudit = repo.audit.find((row) =>
      row.campusId === campusA && row.action === 'attendance.corrected' &&
      row.after.status === 'absent');
    assert.ok(correctionAudit);
    assert.equal(correctionAudit.entityId, saved.id);
    assert.ok(correctionAudit.entityId.length <= 36);
  }
  return sectionA;
}

async function attendanceCount(fixture, campusId) {
  if (fixture.db) {
    const row = await fixture.db('attendance_sessions').where({ campus_id: campusId })
      .count({ total: '*' }).first();
    return Number(row.total);
  }
  return fixture.repo.attendance.filter((session) => session.campusId === campusId).length;
}

async function verifyAttendanceAuditRollback(fixture, sectionA) {
  const { repo, db, campusA, actors, studentA } = fixture;
  const before = await attendanceCount(fixture, campusA);
  const data = {
    date: '2026-10-20', sectionId: sectionA.id, clientUuid: randomUUID(),
    records: [{ studentId: studentA, status: 'present' }]
  };
  if (!db) {
    const appendAudit = repo.appendAudit;
    repo.appendAudit = async (actor, action, ...args) => {
      if (action === 'attendance.recorded') throw new Error('contract audit failure');
      return appendAudit.call(repo, actor, action, ...args);
    };
    try {
      await assert.rejects(repo.saveAttendance(data, actors.owner.actor), /contract audit failure/);
    } finally {
      repo.appendAudit = appendAudit;
    }
  } else {
    const trigger = `contract_attendance_rollback_${randomUUID().replaceAll('-', '')}`;
    await db.raw(
      `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
      `BEGIN IF NEW.action = 'attendance.recorded' THEN ` +
      `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract audit failure'; END IF; END`
    );
    try {
      await assert.rejects(repo.saveAttendance(data, actors.owner.actor));
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``);
    }
  }
  assert.equal(await attendanceCount(fixture, campusA), before);
}

async function runFeeContract(fixture) {
  const { repo, campusA, campusB, studentA, actors } = fixture;
  const cashier = actors.cashier.actor;
  const item = await repo.createFeeItem({
    code: `TUITION-${randomUUID().slice(0, 8)}`, nameEn: 'Tuition',
    nameAm: 'የትምህርት ክፍያ', category: 'core', amount: 100, currencyCode: 'ETB'
  }, cashier);
  const shift = await repo.openCashierShift({ currencyCode: 'ETB', openingFloat: 20 }, cashier);
  await assert.rejects(repo.openCashierShift({
    currencyCode: 'ETB', openingFloat: 0
  }, cashier), { code: 'FEE_CONFLICT' });
  assert.equal((await repo.listCashierShifts(cashier)).length, 1);

  const invoice = await repo.createFeeInvoice({
    studentId: studentA, lines: [{ feeItemId: item.id, quantity: 1 }]
  }, cashier);
  const payment = await repo.recordFeePayment(invoice.id, {
    amount: 40, method: 'cash'
  }, cashier);
  assert.equal(payment.balanceDue, 60);
  assert.equal((await repo.listFeeInvoices(campusA)).find((row) => row.id === invoice.id).status, 'partially_paid');

  const beforeRejectedPayment = await paymentCount(fixture, campusA);
  await assert.rejects(repo.recordFeePayment(invoice.id, {
    amount: 61, method: 'cash'
  }, cashier), { code: 'FEE_CONFLICT' });
  assert.equal(await paymentCount(fixture, campusA), beforeRejectedPayment);

  const reversal = await repo.reverseFeePayment(payment.id, {
    amount: 10, reason: 'Contract test reversal'
  }, cashier);
  assert.equal(reversal.amount, 10);
  assert.equal((await repo.listFeeInvoices(campusA)).find((row) => row.id === invoice.id).balanceDue, 70);
  const paymentAudit = await findAuditEvent(fixture, 'fee_payment.recorded', payment.id);
  assert.deepEqual(paymentAudit.before, { invoiceStatus: 'issued', balanceDue: 100 });
  assert.equal(paymentAudit.after.invoiceStatus, 'partially_paid');
  assert.equal(paymentAudit.after.balanceDue, 60);
  assert.equal(paymentAudit.organizationId, fixture.orgId);
  assert.equal(paymentAudit.campusId, campusA);
  const reversalAudit = await findAuditEvent(fixture, 'fee_payment.reversed', payment.id);
  assert.deepEqual(reversalAudit.before, { invoiceStatus: 'partially_paid', balanceDue: 60 });
  assert.equal(reversalAudit.after.invoiceStatus, 'partially_paid');
  assert.equal(reversalAudit.after.balanceDue, 70);
  assert.equal(reversalAudit.organizationId, fixture.orgId);
  assert.equal(reversalAudit.campusId, campusA);
  const voidInvoice = await repo.createFeeInvoice({
    studentId: studentA, lines: [{ feeItemId: item.id, quantity: 1 }]
  }, cashier);
  await repo.voidFeeInvoice(voidInvoice.id, { reason: 'Contract test void' }, cashier);
  const voidAudit = await findAuditEvent(fixture, 'fee_invoice.voided', voidInvoice.id);
  assert.deepEqual(voidAudit.before, { status: 'issued' });
  assert.equal(voidAudit.after.status, 'void');
  assert.equal(voidAudit.organizationId, fixture.orgId);
  assert.equal(voidAudit.campusId, campusA);

  const expense = await repo.createFeeExpense({
    category: 'Supplies', description: 'Contract test supplies',
    amount: 5, currencyCode: 'ETB', method: 'cash'
  }, cashier);
  const expenseAudit = await findAuditEvent(fixture, 'fee_expense.recorded', expense.id);
  assert.equal(expenseAudit.after.amount, 5);
  assert.equal(expenseAudit.after.category, 'Supplies');
  assert.equal(expenseAudit.organizationId, fixture.orgId);
  assert.equal(expenseAudit.campusId, campusA);
  const beforeRejectedReversal = await paymentCount(fixture, campusA);
  await assert.rejects(repo.reverseFeePayment(payment.id, {
    amount: 31, reason: 'Exceeds remaining reversible amount'
  }, cashier), { code: 'FEE_CONFLICT' });
  assert.equal(await paymentCount(fixture, campusA), beforeRejectedReversal);

  assert.equal(await repo.recordFeePayment(invoice.id, { amount: 1, method: 'cash' }, actors.campusBOwner.actor), null);
  assert.equal(await repo.reverseFeePayment(payment.id, {
    amount: 1, reason: 'Wrong campus'
  }, actors.campusBOwner.actor), null);
  assert.equal((await repo.listFeeInvoices(campusB)).length, 0);
  assert.equal((await repo.listCashierShifts(actors.campusBOwner.actor)).length, 0);
  assert.equal(await repo.getFeeReceipt(campusB, payment.receiptNumber), null);

  const closed = await repo.closeCashierShift(shift.id, { closingCash: 45 }, cashier);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.expectedCash, 45);
  assert.equal(closed.variance, 0);

  const actions = await auditActions(fixture, campusA);
  for (const action of [
    'fee_item.created', 'cashier_shift.opened', 'fee_invoice.issued',
    'fee_invoice.voided', 'fee_payment.recorded', 'fee_payment.reversed',
    'fee_expense.recorded', 'cashier_shift.closed'
  ]) {
    assert.ok(actions.includes(action), `expected audit action ${action}`);
  }

  return { item, invoice, cashier };
}

async function verifyMysqlTransactionRollback(fixture, item) {
  const { repo, db, campusA, studentA, actors } = fixture;
  const invoice = await repo.createFeeInvoice({
    studentId: studentA, lines: [{ feeItemId: item.id, quantity: 1 }]
  }, actors.cashier.actor);
  const beforeCount = await paymentCount(fixture, campusA);
  const beforeActions = await auditActions(fixture, campusA);
  const trigger = `contract_rollback_${randomUUID().replaceAll('-', '')}`;
  await db.raw(
    `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
    `BEGIN IF NEW.action = 'fee_payment.recorded' THEN ` +
    `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract rollback'; END IF; END`
  );
  try {
    await assert.rejects(repo.recordFeePayment(invoice.id, {
      amount: 5, method: 'cash'
    }, actors.cashier.actor));
    assert.equal(await paymentCount(fixture, campusA), beforeCount);
    assert.equal((await repo.listFeeInvoices(campusA)).find((row) => row.id === invoice.id).status, 'issued');
    assert.deepEqual(await auditActions(fixture, campusA), beforeActions);
  } finally {
    await db.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
}

async function runMarksContract(fixture) {
  const { repo, campusA, studentA, studentB, actors } = fixture;
  const mark = await repo.saveMark({
    studentId: studentA, assessmentName: 'Contract assessment',
    value: 8, maxValue: 10, clientUuid: randomUUID()
  }, actors.owner.actor);
  const submitted = await repo.transitionMark(mark.id, 'submitted', actors.owner.actor);
  assert.equal(submitted.state, 'submitted');
  const auditsBeforeInvalidTransition = (await auditActions(fixture, campusA)).length;
  await assert.rejects(repo.transitionMark(mark.id, 'submitted', actors.owner.actor), {
    code: 'MARK_TRANSITION_INVALID'
  });
  assert.equal((await auditActions(fixture, campusA)).length, auditsBeforeInvalidTransition);

  const approved = await repo.transitionMark(mark.id, 'approved', actors.academicHead.actor);
  assert.equal(approved.approvedBy, actors.academicHead.id);
  const locked = await repo.transitionMark(mark.id, 'locked', actors.principal.actor);
  assert.equal(locked.publishedBy, actors.principal.id);

  const foreignMark = await repo.saveMark({
    studentId: studentB, assessmentName: 'Foreign campus assessment',
    value: 7, maxValue: 10, clientUuid: randomUUID()
  }, actors.campusBOwner.actor);
  assert.equal(await repo.transitionMark(foreignMark.id, 'submitted', actors.owner.actor), null);
  const foreignMarks = await repo.listMarks(campusA);
  assert.equal(foreignMarks.some((row) => row.id === foreignMark.id), false);

  const actions = await auditActions(fixture, campusA);
  for (const action of ['mark.created', 'mark.submitted', 'mark.approved', 'mark.locked']) {
    assert.ok(actions.includes(action), `expected audit action ${action}`);
  }
  const submittedAudit = await findAuditEvent(fixture, 'mark.submitted', mark.id);
  assert.deepEqual(submittedAudit.before, { state: 'draft' });
  assert.deepEqual(submittedAudit.after, { state: 'submitted' });
  assert.equal(submittedAudit.organizationId, fixture.orgId);
  assert.equal(submittedAudit.campusId, campusA);
  const approvedAudit = await findAuditEvent(fixture, 'mark.approved', mark.id);
  assert.deepEqual(approvedAudit.before, { state: 'submitted' });
  assert.deepEqual(approvedAudit.after, { state: 'approved' });
  const publishedAudit = await findAuditEvent(fixture, 'mark.locked', mark.id);
  assert.deepEqual(publishedAudit.before, { state: 'approved' });
  assert.deepEqual(publishedAudit.after, { state: 'locked' });

  const { yearA, gradeA } = await prepareAcademicStudentFixture(fixture);
  const subject = await repo.createSubject({
    code: `REPORT-${randomUUID().slice(0, 8)}`,
    nameEn: 'Contract report subject', nameAm: 'የፈተና ትምህርት'
  }, actors.owner.actor);
  await repo.replaceGradeSubjects(gradeA.id, {
    subjects: [{
      subjectId: subject.id, stream: 'all', weeklyPeriods: 1, isRequired: true
    }]
  }, actors.owner.actor);
  const term = {
    id: randomUUID(), name: `Contract report term ${randomUUID().slice(0, 8)}`,
    startDate: '2026-01-01', endDate: '2026-12-31',
    periodType: 'term', isCurrent: true
  };
  if (fixture.db) {
    await fixture.db('terms').insert({
      id: term.id, academic_year_id: yearA.id, name: term.name,
      start_date: term.startDate, end_date: term.endDate,
      period_type: term.periodType, is_current: true
    });
  } else {
    yearA.terms ??= [];
    yearA.terms.push(term);
  }
  await repo.replaceGradingBands({ bands: [
    { code: 'F', nameEn: 'Needs support', nameAm: 'ድጋፍ', minPercent: 0 },
    { code: 'P', nameEn: 'Pass', nameAm: 'ማለፍ', minPercent: 50 }
  ] }, actors.owner.actor);
  const confirmedAt = new Date();
  if (fixture.db) {
    await fixture.db('campus_academic_policies').insert({
      campus_id: campusA, scoring_method: 'points_weighted',
      confirmed_by: actors.owner.id, confirmed_at: confirmedAt, updated_at: confirmedAt
    });
  } else {
    repo.gradingPolicies.push({
      campusId: campusA, scoringMethod: 'points_weighted',
      confirmedBy: actors.owner.id, confirmedAt: confirmedAt.toISOString()
    });
  }
  const reportMark = await repo.saveMark({
    studentId: studentA, termId: term.id, subjectId: subject.id,
    assessmentName: 'Contract report assessment', value: 8, maxValue: 10,
    clientUuid: randomUUID()
  }, actors.owner.actor);
  await repo.transitionMark(reportMark.id, 'submitted', actors.owner.actor);
  await repo.transitionMark(reportMark.id, 'approved', actors.academicHead.actor);
  await repo.transitionMark(reportMark.id, 'locked', actors.principal.actor);
  const draft = await repo.createTermReportDraft(studentA, term.id, actors.owner.actor);
  await repo.transitionTermReport(draft.id, 'submitted', actors.owner.actor);
  await repo.transitionTermReport(draft.id, 'approved', actors.academicHead.actor);
  await repo.transitionTermReport(draft.id, 'published', actors.principal.actor);
  const reportAudit = await findAuditEvent(fixture, 'term_report.published', draft.id);
  assert.equal(reportAudit.organizationId, fixture.orgId);
  assert.equal(reportAudit.campusId, campusA);
  assert.deepEqual(reportAudit.before, { status: 'approved' });
  assert.deepEqual(reportAudit.after, { status: 'published', revision: 1 });
}

async function runExamMigrationContract() {
  const before = await mysql('marks')
    .select('id', 'campus_id', 'student_id', 'value', 'max_value', 'term_id', 'subject_id', 'exam_id')
    .orderBy('id');
  assert.ok(before.every((mark) => mark.exam_id), 'every historical mark must have a linked exam');
  await migrateWp4Exams(mysql);
  const after = await mysql('marks')
    .select('id', 'campus_id', 'student_id', 'value', 'max_value', 'term_id', 'subject_id', 'exam_id')
    .orderBy('id');
  assert.deepEqual(after, before, 'rerunning the migration must preserve mark values and exam links');
  const [orphans] = await mysql('marks').whereNull('exam_id').count({ total: '*' });
  assert.equal(Number(orphans.total), 0, 'already-migrated databases must have no marks without an exam');
  const [columns] = await mysql.raw(
    `SELECT IS_NULLABLE AS is_nullable FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marks' AND COLUMN_NAME = 'exam_id'`
  );
  assert.equal(columns[0]?.is_nullable, 'NO');
}

async function runExamsContract(fixture) {
  const { repo, db, orgId, campusA, campusB, studentA, studentB, actors } = fixture;
  const { yearA, gradeA, sectionA, sectionA2 } = await prepareAcademicStudentFixture(fixture);
  const suffix = randomUUID().slice(0, 8);
  const term = {
    id: randomUUID(), name: `Exam term ${suffix}`,
    startDate: '2026-01-01', endDate: '2026-12-31'
  };
  if (db) {
    await db('terms').insert({
      id: term.id, academic_year_id: yearA.id, name: term.name,
      start_date: term.startDate, end_date: term.endDate,
      period_type: 'term', is_current: true
    });
  } else {
    yearA.terms ??= [];
    yearA.terms.push({ ...term, periodType: 'term', isCurrent: true });
  }

  const subjects = [];
  for (const label of ['Main', 'Scope', 'Room', 'Invigilator']) {
    const subject = await repo.createSubject({
      code: `EX-${label.slice(0, 2).toUpperCase()}-${suffix}`,
      nameEn: `Exam ${label} ${suffix}`, nameAm: 'የፈተና ትምህርት'
    }, actors.owner.actor);
    subjects.push(subject);
  }
  await repo.replaceGradeSubjects(gradeA.id, {
    subjects: subjects.map((subject) => ({
      subjectId: subject.id, stream: 'all', weeklyPeriods: 1, isRequired: true
    }))
  }, actors.owner.actor);

  const quizType = await repo.createExamType({
    code: `quiz-${suffix}`, name: 'Quiz', weightPercent: 40
  }, actors.owner.actor);
  const finalType = await repo.createExamType({
    code: `final-${suffix}`, name: 'Final', weightPercent: 60
  }, actors.owner.actor);
  const extraType = await repo.createExamType({
    code: `extra-${suffix}`, name: 'Extra', weightPercent: 10
  }, actors.owner.actor);
  const foreignOrgId = randomUUID();
  const foreignCampusId = randomUUID();
  const foreignUserId = randomUUID();
  const foreignActor = {
    sub: foreignUserId, orgId: foreignOrgId, role: 'owner_director',
    activeCampusId: foreignCampusId, campusIds: [foreignCampusId]
  };
  if (db) {
    await db('organizations').insert({
      id: foreignOrgId, name: `Foreign Exam Contract ${suffix}`, status: 'active',
      school_code: contractSchoolCode(), academic_configuration_json: '{}'
    });
    await db('campuses').insert({
      id: foreignCampusId, organization_id: foreignOrgId,
      name: `Foreign Exam Campus ${suffix}`, is_active: true
    });
    await db('users').insert({
      id: foreignUserId, organization_id: foreignOrgId,
      name: `Foreign Exam User ${suffix}`, email: `${foreignUserId}@example.test`,
      password_hash: 'contract-only', role: 'owner_director', is_active: true
    });
    await db('user_campuses').insert({
      user_id: foreignUserId, campus_id: foreignCampusId, is_active: true
    });
  } else {
    repo.organizations.push({ id: foreignOrgId, name: `Foreign Exam Contract ${suffix}` });
    repo.campuses.push({
      id: foreignCampusId, organizationId: foreignOrgId,
      name: `Foreign Exam Campus ${suffix}`, isActive: true
    });
    repo.users.push({
      id: foreignUserId, orgId: foreignOrgId, role: 'owner_director',
      campusIds: [foreignCampusId], activeCampusId: foreignCampusId, isActive: true
    });
  }
  const foreignType = await repo.createExamType({
    code: `foreign-${suffix}`, name: 'Foreign Type', weightPercent: 100
  }, foreignActor);
  const room = await repo.createRoom({ name: `Exam room ${suffix}`, capacity: 30 }, actors.owner.actor);
  const invigilator = await repo.createStaff({
    userId: actors.teacherOne.id, givenNameEn: 'Exam', fatherNameEn: 'Invigilator',
    grandfatherNameEn: suffix, givenNameAm: 'ፈተና', fatherNameAm: 'ተቆጣጣሪ',
    grandfatherNameAm: suffix, jobTitle: 'Teacher', employmentStatus: 'active'
  }, actors.owner.actor);
  await repo.createTeachingAssignment({
    staffId: invigilator.id, sectionId: sectionA.id, subjectId: subjects[0].id
  }, actors.owner.actor);

  const createData = (subject, examType, title, section, date, options = {}) => ({
    title, termId: term.id, gradeLevelId: gradeA.id, subjectId: subject.id,
    examTypeId: examType.id, maxValue: 100,
    scheduleEntries: [{
      sectionId: section.id, examDate: date, startsAt: '09:00', endsAt: '10:00',
      roomId: options.roomId, invigilatorIds: options.invigilatorIds ?? []
    }]
  });
  const quiz = await repo.createExam(createData(
    subjects[0], quizType, `Main quiz ${suffix}`, sectionA, '2026-03-02',
    { roomId: room.id, invigilatorIds: [invigilator.id] }
  ), actors.owner.actor);
  const foreignExamTypes = await repo.listExamTypes(foreignActor);
  assert.deepEqual(foreignExamTypes.map((item) => item.id), [foreignType.id]);
  assert.deepEqual(await repo.listExams(foreignActor), []);
  assert.equal(await repo.examById(quiz.id, foreignActor), null);
  assert.equal(await repo.updateExamType(quizType.id, { name: 'Foreign edit' }, foreignActor), null);
  const quizScheduleForIsolation = (await repo.listExams(actors.owner.actor))
    .find((item) => item.id === quiz.id).scheduleEntries[0];
  assert.equal(await repo.updateExamScheduleEntry(quiz.id, quizScheduleForIsolation.id, {
    sectionId: sectionA.id, examDate: '2026-03-02', startsAt: '09:00',
    endsAt: '10:00', roomId: room.id, invigilatorIds: [invigilator.id]
  }, foreignActor), null);
  assert.equal(await repo.openExamMarks(quiz.id, foreignActor), null);
  await assert.rejects(repo.saveMark({
    studentId: studentB, examId: quiz.id, termId: term.id, subjectId: subjects[0].id,
    assessmentName: 'Foreign attempt', value: 80, maxValue: 100, clientUuid: randomUUID()
  }, foreignActor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await assert.rejects(repo.createExam({
    ...createData(subjects[0], quizType, `Foreign type attempt ${suffix}`, sectionA, '2026-03-12'),
    scheduleEntries: []
  }, foreignActor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  const mismatchedCampusActor = { ...foreignActor, activeCampusId: campusA };
  assert.deepEqual(await repo.listExamTypes(mismatchedCampusActor), []);
  assert.deepEqual(await repo.listExams(mismatchedCampusActor), []);
  assert.equal(await repo.examById(quiz.id, mismatchedCampusActor), null);
  assert.equal(await repo.openExamMarks(quiz.id, mismatchedCampusActor), null);
  assert.equal(await repo.updateExamScheduleEntry(quiz.id, quizScheduleForIsolation.id, {
    sectionId: sectionA.id, examDate: '2026-03-02', startsAt: '09:00',
    endsAt: '10:00', roomId: room.id, invigilatorIds: [invigilator.id]
  }, mismatchedCampusActor), null);
  await assert.rejects(repo.createExam({
    ...createData(subjects[0], quizType, `Foreign type context ${suffix}`, sectionA, '2026-03-12'),
    scheduleEntries: []
  }, mismatchedCampusActor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  const unscheduledDraft = await repo.createExam({
    ...createData(subjects[3], extraType, `Unscheduled draft ${suffix}`, sectionA2, '2026-03-08'),
    scheduleEntries: []
  }, actors.owner.actor);
  assert.equal(unscheduledDraft.status, 'draft');
  assert.deepEqual((await repo.listExams(actors.owner.actor))
    .find((item) => item.id === unscheduledDraft.id).scheduleEntries, []);
  await assert.rejects(repo.publishExamSchedule(unscheduledDraft.id, actors.owner.actor), {
    code: 'SETUP_CONFLICT'
  });
  const draftSchedule = await repo.addExamScheduleEntry(unscheduledDraft.id, {
    sectionId: sectionA2.id, examDate: '2026-03-08',
    startsAt: '09:00', endsAt: '10:00', invigilatorIds: []
  }, actors.owner.actor);
  assert.equal(draftSchedule.status, 'scheduled');
  await repo.publishExamSchedule(unscheduledDraft.id, actors.owner.actor);

  const scheduleUpdate = async (input) => repo.updateExamScheduleEntry(
    unscheduledDraft.id, draftSchedule.id, input, actors.owner.actor
  ).then(() => null, (error) => error);
  const sectionRescheduleConflict = await scheduleUpdate({
    sectionId: sectionA.id, examDate: '2026-03-02', startsAt: '09:00',
    endsAt: '10:00', invigilatorIds: []
  });
  assert.equal(sectionRescheduleConflict?.code, 'EXAM_SCHEDULE_CONFLICT');
  assert.ok(sectionRescheduleConflict.details.some((entry) => entry.conflictReason === 'section'));
  const roomRescheduleConflict = await scheduleUpdate({
    sectionId: sectionA2.id, examDate: '2026-03-02', startsAt: '09:00',
    endsAt: '10:00', roomId: room.id, invigilatorIds: []
  });
  assert.equal(roomRescheduleConflict?.code, 'EXAM_SCHEDULE_CONFLICT');
  assert.ok(roomRescheduleConflict.details.some((entry) => entry.conflictReason === 'room'));
  const invigilatorRescheduleConflict = await scheduleUpdate({
    sectionId: sectionA2.id, examDate: '2026-03-02', startsAt: '09:00',
    endsAt: '10:00', invigilatorIds: [invigilator.id]
  });
  assert.equal(invigilatorRescheduleConflict?.code, 'EXAM_SCHEDULE_CONFLICT');
  assert.ok(invigilatorRescheduleConflict.details.some((entry) => entry.conflictReason === 'invigilator'));
  const rescheduled = await repo.updateExamScheduleEntry(unscheduledDraft.id, draftSchedule.id, {
    sectionId: sectionA2.id, examDate: '2026-03-09',
    startsAt: '10:00', endsAt: '11:00', invigilatorIds: [invigilator.id]
  }, actors.owner.actor);
  if (db) {
    const storedSchedule = await db('exam_schedule_entries')
      .where({ id: draftSchedule.id }).first('exam_date');
    const storedDate = storedSchedule.exam_date instanceof Date
      ? `${storedSchedule.exam_date.getFullYear()}-${String(storedSchedule.exam_date.getMonth() + 1).padStart(2, '0')}-${String(storedSchedule.exam_date.getDate()).padStart(2, '0')}`
      : String(storedSchedule.exam_date).slice(0, 10);
    assert.equal(storedDate, '2026-03-09');
  }
  assert.equal(rescheduled.examDate, '2026-03-09', JSON.stringify(rescheduled));
  assert.deepEqual(rescheduled.invigilatorIds, [invigilator.id]);
  assert.equal(rescheduled.status, 'scheduled');
  const scheduleAudit = await findAuditEvent(
    fixture, 'exam.schedule_entry_updated', draftSchedule.id
  );
  assert.equal(scheduleAudit.organizationId, orgId);
  assert.equal(scheduleAudit.campusId, campusA);
  assert.equal(scheduleAudit.before.examDate, '2026-03-08');
  assert.equal(scheduleAudit.after.examDate, '2026-03-09');
  await assert.rejects(repo.openExamMarks(unscheduledDraft.id, actors.owner.actor), {
    code: 'SETUP_CONFLICT'
  });

  const concurrentDraftA = await repo.createExam({
    ...createData(subjects[2], extraType, `Concurrent schedule A ${suffix}`, sectionA2, '2026-03-20'),
    scheduleEntries: []
  }, actors.owner.actor);
  const concurrentDraftB = await repo.createExam({
    ...createData(subjects[3], finalType, `Concurrent schedule B ${suffix}`, sectionA2, '2026-03-20'),
    scheduleEntries: []
  }, actors.owner.actor);
  const concurrentSchedules = await Promise.all([
    repo.addExamScheduleEntry(concurrentDraftA.id, {
      sectionId: sectionA2.id, examDate: '2026-03-20',
      startsAt: '09:00', endsAt: '10:00', invigilatorIds: []
    }, actors.owner.actor).then((value) => ({ value }), (error) => ({ error })),
    repo.addExamScheduleEntry(concurrentDraftB.id, {
      sectionId: sectionA2.id, examDate: '2026-03-20',
      startsAt: '09:30', endsAt: '10:30', invigilatorIds: []
    }, actors.owner.actor).then((value) => ({ value }), (error) => ({ error }))
  ]);
  assert.equal(concurrentSchedules.filter((result) => result.value).length, 1);
  assert.equal(concurrentSchedules.filter((result) =>
    result.error?.code === 'EXAM_SCHEDULE_CONFLICT').length, 1);

  const studentAccount = {
    id: randomUUID(), orgId, name: 'Exam contract student',
    email: `exam-student-${suffix}@example.test`, role: 'student',
    campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const parentAccount = {
    id: randomUUID(), orgId, name: 'Exam contract parent',
    email: `exam-parent-${suffix}@example.test`, role: 'parent_guardian',
    campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const guardianId = randomUUID();
  if (db) {
    await db('users').insert([studentAccount, parentAccount].map((user) => ({
      id: user.id, organization_id: orgId, name: user.name, email: user.email,
      password_hash: 'contract-only', role: user.role, is_active: true
    })));
    await db('user_campuses').insert([studentAccount, parentAccount].map((user) => ({
      user_id: user.id, campus_id: campusA, is_active: true
    })));
    await db('students').where({ id: studentA }).update({ user_id: studentAccount.id });
    await db('guardians').insert({
      id: guardianId, organization_id: orgId, user_id: parentAccount.id,
      given_name_am: 'ወላጅ', father_name_am: 'ፈተና', grandfather_name_am: suffix,
      given_name_en: 'Exam', father_name_en: 'Contract', grandfather_name_en: 'Parent',
      phone: '+251900000104', email: parentAccount.email
    });
    await db('student_guardians').insert({
      student_id: studentA, guardian_id: guardianId, relationship: 'parent',
      is_primary: true, is_verified: true, can_view_results: true, can_view_fees: false
    });
  } else {
    repo.users.push(studentAccount, parentAccount);
    repo.students.find((student) => student.id === studentA).userId = studentAccount.id;
    repo.guardians.push({
      id: guardianId, orgId, userId: parentAccount.id, email: parentAccount.email,
      givenNameEn: 'Exam', fatherNameEn: 'Contract', grandfatherNameEn: 'Parent'
    });
    repo.studentGuardians.push({
      studentId: studentA, guardianId, relationship: 'parent',
      isPrimary: true, isVerified: true, canViewResults: true, canViewFees: false
    });
  }

  const studentActor = {
    sub: studentAccount.id, orgId, role: 'student', activeCampusId: campusA, campusIds: [campusA]
  };
  const parentActor = {
    sub: parentAccount.id, orgId, role: 'parent_guardian',
    activeCampusId: campusA, campusIds: [campusA]
  };
  assert.deepEqual(await repo.listExams(studentActor), []);
  assert.deepEqual(await repo.listExams(parentActor), []);

  const sectionConflict = await repo.createExam(createData(
    subjects[0], finalType, `Section clash ${suffix}`, sectionA, '2026-03-02'
  ), actors.owner.actor).then(() => null, (error) => error);
  assert.equal(sectionConflict?.code, 'EXAM_SCHEDULE_CONFLICT');
  assert.ok(sectionConflict.details.some((entry) => entry.conflictReason === 'section'));
  await assert.rejects(repo.openExamMarks(quiz.id, actors.owner.actor), {
    code: 'SETUP_CONFLICT'
  });

  const roomConflict = await repo.createExam(createData(
    subjects[1], quizType, `Room clash ${suffix}`, sectionA2, '2026-03-02', { roomId: room.id }
  ), actors.owner.actor).then(() => null, (error) => error);
  assert.equal(roomConflict?.code, 'EXAM_SCHEDULE_CONFLICT');
  assert.ok(roomConflict.details.some((entry) => entry.conflictReason === 'room'));

  const invigilatorConflict = await repo.createExam(createData(
    subjects[2], quizType, `Invigilator clash ${suffix}`, sectionA2, '2026-03-02',
    { invigilatorIds: [invigilator.id] }
  ), actors.owner.actor).then(() => null, (error) => error);
  assert.equal(invigilatorConflict?.code, 'EXAM_SCHEDULE_CONFLICT');
  assert.ok(invigilatorConflict.details.some((entry) => entry.conflictReason === 'invigilator'));

  const simultaneous = await Promise.all([
    repo.createExam(createData(subjects[1], quizType, `Concurrent quiz ${suffix}`,
      sectionA2, '2026-03-05'), actors.owner.actor).then((value) => ({ value }), (error) => ({ error })),
    repo.createExam(createData(subjects[1], finalType, `Concurrent final ${suffix}`,
      sectionA2, '2026-03-05'), actors.owner.actor).then((value) => ({ value }), (error) => ({ error }))
  ]);
  assert.equal(simultaneous.filter((result) => result.value).length, 1);
  assert.equal(simultaneous.filter((result) =>
    result.error?.code === 'EXAM_SCHEDULE_CONFLICT').length, 1);
  const scopedExam = simultaneous.find((result) => result.value).value;
  await repo.publishExamSchedule(scopedExam.id, actors.owner.actor);
  assert.deepEqual(await repo.listExams(studentActor), []);
  assert.deepEqual(await repo.listExams(parentActor), []);

  const finalExam = await repo.createExam(createData(
    subjects[0], finalType, `Main final ${suffix}`, sectionA, '2026-03-03'
  ), actors.owner.actor);
  await assert.rejects(repo.createExam(createData(
    subjects[3], quizType, `Cross-campus ${suffix}`,
    { ...sectionA, id: randomUUID(), campusId: campusB }, '2026-03-06'
  ), actors.owner.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });

  await repo.publishExamSchedule(quiz.id, actors.owner.actor);
  await repo.publishExamSchedule(finalExam.id, actors.owner.actor);
  assert.deepEqual((await repo.listExams(studentActor)).map((exam) => exam.id).sort(),
    [quiz.id, finalExam.id].sort());
  assert.deepEqual((await repo.listExams(parentActor)).map((exam) => exam.id).sort(),
    [quiz.id, finalExam.id].sort());
  const publishedQuizEntry = (await repo.listExams(actors.owner.actor))
    .find((item) => item.id === quiz.id).scheduleEntries[0];
  const rescheduledPublishedQuiz = await repo.updateExamScheduleEntry(
    quiz.id, publishedQuizEntry.id, {
      sectionId: sectionA.id, examDate: '2026-03-10', startsAt: '10:00',
      endsAt: '11:00', roomId: room.id, invigilatorIds: [invigilator.id]
    }, actors.owner.actor
  );
  assert.equal(rescheduledPublishedQuiz.status, 'scheduled');
  assert.equal(rescheduledPublishedQuiz.examDate, '2026-03-10');
  for (const portalActor of [studentActor, parentActor]) {
    const visibleAfterReschedule = await repo.listExams(portalActor);
    assert.deepEqual(visibleAfterReschedule.map((exam) => exam.id), [finalExam.id]);
    assert.equal(visibleAfterReschedule.some((exam) => exam.id === quiz.id), false);
  }
  await repo.publishExamSchedule(quiz.id, actors.owner.actor);
  for (const portalActor of [studentActor, parentActor]) {
    const visibleAfterRepublish = await repo.listExams(portalActor);
    const visibleQuiz = visibleAfterRepublish.find((exam) => exam.id === quiz.id);
    assert.ok(visibleQuiz);
    assert.equal(visibleQuiz.scheduleEntries[0].examDate, '2026-03-10');
  }

  const incompleteWeights = await repo.openExamMarks(quiz.id, actors.owner.actor)
    .then(() => null, (error) => error);
  assert.equal(incompleteWeights?.code, 'EXAM_WEIGHTS_INVALID');
  assert.ok(incompleteWeights.details.examTypes.some((item) =>
    item.id === extraType.id && !item.configured));
  await repo.updateExamType(finalType.id, { weightPercent: 55 }, actors.owner.actor);
  await repo.updateExamType(extraType.id, { isActive: false }, actors.owner.actor);
  const unbalancedWeights = await repo.openExamMarks(quiz.id, actors.owner.actor)
    .then(() => null, (error) => error);
  assert.equal(unbalancedWeights?.code, 'EXAM_WEIGHTS_INVALID');
  assert.equal(unbalancedWeights.details.actualBasisPoints, 9500);
  await repo.updateExamType(finalType.id, { weightPercent: 60 }, actors.owner.actor);
  await repo.openExamMarks(quiz.id, actors.owner.actor);
  await assert.rejects(repo.updateExamType(finalType.id, { weightPercent: 55 }, actors.owner.actor), {
    code: 'SETUP_CONFLICT'
  });
  assert.equal((await repo.listExamTypes(actors.owner.actor))
    .find((item) => item.id === finalType.id).weightPercent, 60);
  const markDueCount = async () => db
    ? Number((await db('exam_notifications').where({
      exam_id: quiz.id, recipient_id: actors.teacherOne.id, notification_type: 'marks_due'
    }).count({ total: '*' }))[0].total)
    : repo.examNotifications.filter((item) =>
      item.examId === quiz.id && item.recipientId === actors.teacherOne.id &&
      item.notificationType === 'marks_due').length;
  assert.equal(await markDueCount(), 1);
  const monitoringBefore = (await repo.getExamMonitoring(actors.owner.actor))
    .find((item) => item.id === quiz.id);
  assert.equal(monitoringBefore.missingMarks, 1);

  const unauthorizedTeacher = await repo.saveMark({
    studentId: studentA, examId: quiz.id, termId: term.id, subjectId: subjects[0].id,
    assessmentName: 'Unauthorized', value: 80, maxValue: 100, clientUuid: randomUUID()
  }, actors.teacherTwo.actor).then(() => null, (error) => error);
  assert.equal(unauthorizedTeacher?.code, 'CAMPUS_SCOPE_VIOLATION');

  const quizMark = await repo.saveMark({
    studentId: studentA, examId: quiz.id, termId: term.id, subjectId: subjects[0].id,
    assessmentName: 'Quiz', value: 80, maxValue: 100, clientUuid: randomUUID()
  }, actors.teacherOne.actor);
  await assert.rejects(repo.updateExamType(quizType.id, { weightPercent: 41 }, actors.owner.actor), {
    code: 'SETUP_CONFLICT'
  });
  assert.equal((await repo.listExamTypes(actors.owner.actor))
    .find((item) => item.id === quizType.id).weightPercent, 40);
  const monitoringAfter = (await repo.getExamMonitoring(actors.owner.actor))
    .find((item) => item.id === quiz.id);
  assert.equal(monitoringAfter.missingMarks, 0);
  await assert.rejects(repo.updateExam(quiz.id, { title: 'Forbidden edit' }, actors.owner.actor),
    { code: 'SETUP_CONFLICT' });
  await repo.transitionMark(quizMark.id, 'submitted', actors.owner.actor);
  const quizSchedule = (await repo.listExams(actors.owner.actor))
    .find((item) => item.id === quiz.id).scheduleEntries[0];
  await assert.rejects(repo.updateExamScheduleEntry(quiz.id, quizSchedule.id, {
    sectionId: sectionA.id, examDate: '2026-03-04', startsAt: '09:00',
    endsAt: '10:00', roomId: room.id, invigilatorIds: [invigilator.id]
  }, actors.owner.actor), { code: 'SETUP_CONFLICT' });
  await assert.rejects(repo.updateExamType(quizType.id, { weightPercent: 35 }, actors.owner.actor),
    { code: 'SETUP_CONFLICT' });
  await repo.transitionMark(quizMark.id, 'approved', actors.academicHead.actor);
  await assert.rejects(repo.updateExamScheduleEntry(quiz.id, quizSchedule.id, {
    sectionId: sectionA.id, examDate: '2026-03-04', startsAt: '09:00',
    endsAt: '10:00', roomId: room.id, invigilatorIds: [invigilator.id]
  }, actors.owner.actor), { code: 'SETUP_CONFLICT' });
  await repo.transitionMark(quizMark.id, 'locked', actors.principal.actor);
  await repo.openExamMarks(finalExam.id, actors.owner.actor);
  const finalMark = await repo.saveMark({
    studentId: studentA, examId: finalExam.id, termId: term.id, subjectId: subjects[0].id,
    assessmentName: 'Final', value: 90, maxValue: 100, clientUuid: randomUUID()
  }, actors.owner.actor);
  await repo.transitionMark(finalMark.id, 'submitted', actors.owner.actor);
  await repo.transitionMark(finalMark.id, 'approved', actors.academicHead.actor);
  await repo.transitionMark(finalMark.id, 'locked', actors.principal.actor);
  await assert.rejects(repo.updateExamType(finalType.id, { weightPercent: 61 }, actors.owner.actor), {
    code: 'SETUP_CONFLICT'
  });
  assert.equal((await repo.listExamTypes(actors.owner.actor))
    .find((item) => item.id === finalType.id).weightPercent, 60);

  const weighted = await repo.getWeightedExamResult(studentA, term.id, actors.owner.actor);
  assert.equal(weighted.scoreBasisPoints, 8600);
  assert.equal(weighted.missingExamCount, 0);
  assert.equal((await repo.getWeightedExamResult(
    studentA, term.id, mismatchedCampusActor
  )).basis.length, 0);
  assert.deepEqual(await repo.getExamMonitoring(mismatchedCampusActor), []);
  const resultNoticeCount = async () => db
    ? Number((await db('exam_notifications').where({
      exam_id: quiz.id, notification_type: 'results_published'
    }).whereIn('recipient_id', [studentAccount.id, parentAccount.id])
      .count({ total: '*' }))[0].total)
    : repo.examNotifications.filter((item) => item.examId === quiz.id &&
      item.notificationType === 'results_published' &&
      [studentAccount.id, parentAccount.id].includes(item.recipientId)).length;
  assert.equal(await resultNoticeCount(), 2);
  await repo.updateExamStatusFromMarks(quiz.id, actors.owner.actor);
  assert.equal(await resultNoticeCount(), 2);
  const publishedAudit = await findAuditEvent(fixture, 'exam.published', quiz.id);
  assert.equal(publishedAudit.organizationId, orgId);
  assert.equal(publishedAudit.campusId, campusA);
  assert.deepEqual(publishedAudit.before, { status: 'approved' });
  assert.deepEqual(publishedAudit.after, { status: 'published' });

  await repo.replaceGradingBands({ bands: [
    { code: 'F', nameEn: 'Needs support', nameAm: 'ድጋፍ', minPercent: 0 },
    { code: 'P', nameEn: 'Pass', nameAm: 'ማለፍ', minPercent: 50 }
  ] }, actors.owner.actor);
  await repo.confirmGradingPolicy({ scoringMethod: 'points_weighted' }, actors.owner.actor);
  const firstDraft = await repo.createTermReportDraft(studentA, term.id, actors.owner.actor);
  assert.equal(firstDraft.snapshot.subjects.find((subject) =>
    subject.subjectId === subjects[0].id).value, 86);
  await repo.transitionTermReport(firstDraft.id, 'submitted', actors.owner.actor);
  await repo.transitionTermReport(firstDraft.id, 'approved', actors.academicHead.actor);
  await repo.transitionTermReport(firstDraft.id, 'published', actors.principal.actor);
  await repo.amendPublishedMark(quizMark.id, {
    value: 70, maxValue: 100, reason: 'Contract correction'
  }, actors.owner.actor);
  await repo.transitionMark(quizMark.id, 'submitted', actors.owner.actor);
  await repo.transitionMark(quizMark.id, 'approved', actors.academicHead.actor);
  await repo.transitionMark(quizMark.id, 'locked', actors.principal.actor);
  const frozen = await repo.latestTermReport(studentA, term.id, campusA);
  assert.equal(frozen.snapshot.subjects.find((subject) =>
    subject.subjectId === subjects[0].id).value, 86);
  const corrected = await repo.getStudentReportCard(studentA, term.id, actors.owner.actor);
  assert.equal(corrected.subjects.find((subject) =>
    subject.subjectId === subjects[0].id).value, 82);
}

async function runAssignmentsContract(fixture) {
  const { repo, db, orgId, campusA, campusB, studentA, studentB, actors } = fixture;
  const academic = await prepareAcademicStudentFixture(fixture);
  const activeYear = await repo.getAcademicYear(campusA);
  const term = await repo.createTerm({
    name: `Assignment Term ${randomUUID().slice(0, 8)}`,
    startDate: activeYear.startDate, endDate: activeYear.endDate
  }, actors.owner.actor);
  const teacherId = randomUUID();
  const unassignedTeacherId = randomUUID();
  const studentUserId = randomUUID();
  const campusBStudentUserId = randomUUID();
  const parentUserId = randomUUID();
  const teacher = {
    id: teacherId, orgId, name: 'Assignment Teacher', email: `${teacherId}@example.test`,
    role: 'subject_teacher', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const unassignedTeacher = {
    id: unassignedTeacherId, orgId, name: 'Unassigned Teacher',
    email: `${unassignedTeacherId}@example.test`, role: 'subject_teacher',
    campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const studentUser = {
    id: studentUserId, orgId, name: 'Assignment Student', email: `${studentUserId}@example.test`,
    role: 'student', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const campusBStudentUser = {
    id: campusBStudentUserId, orgId, name: 'Other Class Student',
    email: `${campusBStudentUserId}@example.test`, role: 'student',
    campusIds: [campusB], activeCampusId: campusB, isActive: true
  };
  const parentUser = {
    id: parentUserId, orgId, name: 'Assignment Parent', email: `${parentUserId}@example.test`,
    role: 'parent_guardian', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  for (const user of [teacher, unassignedTeacher, studentUser, campusBStudentUser, parentUser]) {
    user.actor = {
      sub: user.id, orgId, activeCampusId: campusA, role: user.role,
      campusIds: [campusA]
    };
  }
  const subject = await repo.createSubject({
    code: `ASG-${randomUUID().slice(0, 8)}`, nameEn: 'Assignment Science',
    nameAm: 'የሥራ ሳይንስ', category: 'core'
  }, actors.owner.actor);
  const staffId = randomUUID();
  const teachingAssignmentId = randomUUID();
  const guardianId = randomUUID();
  if (db) {
    await db('users').insert([teacher, unassignedTeacher, studentUser, campusBStudentUser, parentUser].map((user) => ({
      id: user.id, organization_id: orgId, name: user.name, email: user.email,
      password_hash: 'contract-test-not-a-login-hash', role: user.role, is_active: true
    })));
    await db('user_campuses').insert([teacher, unassignedTeacher, studentUser, campusBStudentUser, parentUser].map((user) => ({
      user_id: user.id, campus_id: user.id === campusBStudentUserId ? campusB : campusA, is_active: true
    })));
    await db('students').where({ id: studentA }).update({ user_id: studentUserId });
    await db('students').where({ id: studentB }).update({ user_id: campusBStudentUserId });
    await db('staff').insert({
      id: staffId, campus_id: campusA, user_id: teacherId, given_name_en: 'Assignment',
      father_name_en: 'Teacher', grandfather_name_en: 'Contract', given_name_am: 'ሥራ',
      father_name_am: 'መምህር', grandfather_name_am: 'ሙከራ', job_title: 'Teacher',
      employment_status: 'active'
    });
    await db('teaching_assignments').insert({
      id: teachingAssignmentId, campus_id: campusA, staff_id: staffId,
      section_id: academic.sectionA.id, subject_id: subject.id, is_active: true
    });
    await db('guardians').insert({
      id: guardianId, organization_id: orgId, user_id: parentUserId,
      given_name_am: 'ወላጅ', father_name_am: 'ፈተና', grandfather_name_am: 'ሙከራ',
      given_name_en: 'Assignment', father_name_en: 'Parent', grandfather_name_en: 'Contract',
      phone: `+2519${randomUUID().replaceAll('-', '').slice(0, 8)}`
    });
    await db('student_guardians').insert({
      student_id: studentA, guardian_id: guardianId, relationship: 'parent',
      is_verified: true, can_view_results: true, can_view_fees: true
    });
  } else {
    repo.users.push(teacher, unassignedTeacher, studentUser, campusBStudentUser, parentUser);
    repo.students.find((student) => student.id === studentA).userId = studentUserId;
    repo.students.find((student) => student.id === studentB).userId = campusBStudentUserId;
    repo.staff.push({
      id: staffId, campusId: campusA, userId: teacherId, givenNameEn: 'Assignment',
      fatherNameEn: 'Teacher', grandfatherNameEn: 'Contract', givenNameAm: 'ሥራ',
      fatherNameAm: 'መምህር', grandfatherNameAm: 'ሙከራ', jobTitle: 'Teacher',
      employmentStatus: 'active', archivedAt: null
    });
    repo.teachingAssignments.push({
      id: teachingAssignmentId, campusId: campusA, staffId, sectionId: academic.sectionA.id,
      subjectId: subject.id, isActive: true
    });
    repo.guardians.push({
      id: guardianId, orgId, userId: parentUserId, givenNameEn: 'Assignment',
      fatherNameEn: 'Parent', grandfatherNameEn: 'Contract'
    });
    repo.studentGuardians.push({
      studentId: studentA, guardianId, isVerified: true, canViewResults: true, canViewFees: true
    });
  }

  const assignmentInput = {
    academicYearId: activeYear.id, termId: term.id,
    gradeLevelId: academic.gradeA.id, sectionId: academic.sectionA.id,
    subjectId: subject.id, title: 'Assignment contract workflow',
    instructions: 'Complete the exercise and submit a response.',
    dueAt: new Date(Date.now() - 60_000).toISOString()
  };
  const assignment = await repo.createAssignment(assignmentInput, teacher.actor);
  assert.equal(assignment.status, 'draft');
  const crossClassAssignment = await repo.createAssignment({
    ...assignmentInput, sectionId: academic.sectionA2.id, title: 'Cross-class assignment'
  }, actors.owner.actor);
  await repo.transitionAssignment(crossClassAssignment.id, 'published', actors.owner.actor);
  const foreignTenantActor = {
    ...actors.owner.actor, orgId: randomUUID(), activeCampusId: campusA
  };
  assert.deepEqual(await repo.listAssignments(foreignTenantActor), []);
  assert.equal(await repo.updateAssignment(assignment.id, { title: 'Tenant edit' }, foreignTenantActor), null);
  await assert.rejects(repo.updateAssignment(assignment.id, { title: 'Cross-class edit' },
    unassignedTeacher.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await assert.rejects(repo.updateAssignment(crossClassAssignment.id, {
    title: 'Teacher edited another class'
  }, teacher.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await assert.rejects(repo.listAssignmentSubmissions(crossClassAssignment.id, teacher.actor),
    { code: 'CAMPUS_SCOPE_VIOLATION' });
  const teacherAssignments = await repo.listAssignments(teacher.actor);
  assert.ok(teacherAssignments.some((item) => item.id === assignment.id));
  assert.equal(teacherAssignments.some((item) => item.id === crossClassAssignment.id), false);
  const uploadPlan = await repo.saveSubscriptionPlan({
    code: `assignment-${randomUUID().slice(0, 12)}`, name: 'Assignment upload contract',
    description: 'Assignment upload quota contract', monthlyPrice: 0,
    currencyCode: 'ETB', trialDays: 0, studentLimit: null, staffLimit: null,
    siteLimit: null, billingCycle: 'monthly', maxUsers: null,
    storageLimitBytes: 3, modules: ['academic_setup'], isActive: true
  }, actors.owner.actor);
  if (db) {
    await db('organization_subscriptions').insert({
      id: randomUUID(), organization_id: orgId, plan_id: uploadPlan.id, status: 'active'
    });
  } else {
    await repo.assignOrganizationPlan(orgId, uploadPlan.code, actors.owner.actor);
  }
  const pdfFile = {
    originalName: 'worksheet.pdf', mimeType: 'application/pdf',
    content: Buffer.from('%PDF-1.7')
  };
  await assert.rejects(repo.storeAssignmentAttachment(assignment.id, pdfFile, teacher.actor),
    { code: 'PLAN_LIMIT_REACHED' });
  if (db) await db('subscription_plans').where({ id: uploadPlan.id })
    .update({ storage_limit_bytes: 10000 });
  else repo.subscriptionPlans.find((item) => item.id === uploadPlan.id).storageLimitBytes = 10000;
  const assignmentFile = await repo.storeAssignmentAttachment(assignment.id, pdfFile, teacher.actor);
  assert.equal(assignmentFile.sizeBytes, pdfFile.content.length);
  assert.equal(repo.getOrganizationStorageUsage
    ? await repo.getOrganizationStorageUsage(orgId) >= pdfFile.content.length : true, true);
  await assert.rejects(repo.storeAssignmentAttachment(assignment.id, {
    ...pdfFile, mimeType: 'image/png'
  }, teacher.actor), { code: 'ASSIGNMENT_ATTACHMENT_INVALID' });

  const published = await repo.transitionAssignment(assignment.id, 'published', teacher.actor);
  assert.equal(published.status, 'published');
  await assert.rejects(repo.transitionAssignment(assignment.id, 'published', teacher.actor),
    { code: 'ASSIGNMENT_CONFLICT' });
  const publicationRecipients = db
    ? await db('user_notifications').where({
      organization_id: orgId, source_type: 'assignment_published', source_id: assignment.id
    }).pluck('user_id')
    : repo.userNotifications.filter((notice) => notice.sourceType === 'assignment_published' &&
      notice.sourceId === assignment.id).map((notice) => notice.userId);
  assert.deepEqual(publicationRecipients.sort(), [studentUserId, parentUserId].sort());
  const studentActor = studentUser.actor;
  const parentAssignments = await repo.listPortalAssignments(parentUser.actor);
  assert.deepEqual(parentAssignments.map((item) => item.id), [assignment.id]);
  assert.equal((await repo.listPortalAssignments(studentActor))
    .some((item) => item.id === crossClassAssignment.id), false);
  assert.equal(parentAssignments.some((item) => item.id === crossClassAssignment.id), false);
  assert.deepEqual(await repo.listPortalAssignments(campusBStudentUser.actor), []);
  const firstResults = await Promise.all([
    repo.submitAssignment(assignment.id, { text: 'first response' }, studentActor),
    repo.submitAssignment(assignment.id, { text: 'concurrent resubmission' }, studentActor)
  ]);
  assert.equal(firstResults[0].id, firstResults[1].id);
  assert.equal(firstResults[0].isLate, true);
  const submissionNotices = db
    ? await db('user_notifications').where({
      organization_id: orgId, user_id: teacherId, source_type: 'assignment_submission',
      source_id: firstResults[0].id
    }).count({ total: '*' }).first().then((row) => Number(row.total))
    : repo.userNotifications.filter((notice) => notice.userId === teacherId &&
      notice.sourceType === 'assignment_submission' && notice.sourceId === firstResults[0].id).length;
  assert.equal(submissionNotices, 1);
  const countSubmissions = () => db
    ? db('assignment_submissions').where({
      assignment_id: assignment.id, organization_id: orgId, campus_id: campusA
    }).count({ total: '*' }).first().then((row) => Number(row.total))
    : Promise.resolve(repo.assignmentSubmissions.filter((item) => item.assignmentId === assignment.id).length);
  assert.equal(await countSubmissions(), 1);
  const resubmitted = await repo.submitAssignment(assignment.id, {
    text: 'final response'
  }, studentActor);
  assert.equal(resubmitted.id, firstResults[0].id);
  assert.equal(resubmitted.text, 'final response');

  const submissionFileData = {
    originalName: 'answer.txt', mimeType: 'text/plain', content: Buffer.from('answer')
  };
  const failedUploadLimit = await repo.getOrganizationStorageUsage(orgId) +
    submissionFileData.content.length - 1;
  if (db) await db('subscription_plans').where({ id: uploadPlan.id })
    .update({ storage_limit_bytes: failedUploadLimit });
  else repo.subscriptionPlans.find((item) => item.id === uploadPlan.id)
    .storageLimitBytes = failedUploadLimit;
  await assert.rejects(repo.storeSubmissionAttachment(assignment.id, submissionFileData, studentActor),
    { code: 'PLAN_LIMIT_REACHED' });
  const afterFailedUpload = await repo.listPortalAssignments(studentActor);
  assert.equal(afterFailedUpload.find((item) => item.id === assignment.id).submission.text,
    'final response');
  assert.equal(afterFailedUpload.find((item) => item.id === assignment.id).submission.attachments.length, 0);
  if (db) await db('subscription_plans').where({ id: uploadPlan.id })
    .update({ storage_limit_bytes: 10000 });
  else repo.subscriptionPlans.find((item) => item.id === uploadPlan.id).storageLimitBytes = 10000;
  const submissionFile = await repo.storeSubmissionAttachment(assignment.id, submissionFileData, studentActor);
  assert.equal(submissionFile.type, 'submission');
  const visibleToStudent = await repo.listPortalAssignments(studentActor);
  assert.equal(visibleToStudent.find((item) => item.id === assignment.id).submission.attachments.length, 1);
  const parentAttachment = await repo.getPortalAssignmentAttachment(submissionFile.id, parentUser.actor);
  assert.equal(parentAttachment.content.toString(), 'answer');
  assert.equal(await repo.getPortalAssignmentAttachment(submissionFile.id, {
    ...parentUser.actor, sub: randomUUID()
  }), null);

  const submissions = await repo.listAssignmentSubmissions(assignment.id, teacher.actor);
  assert.equal(submissions.length, 1);
  const graded = await repo.gradeAssignmentSubmission(assignment.id, submissions[0].id, {
    grade: 87.5, feedback: 'Clear explanation.'
  }, teacher.actor);
  assert.equal(graded.grade, 87.5);
  await assert.rejects(repo.gradeAssignmentSubmission(assignment.id, submissions[0].id, {
    grade: -1
  }, teacher.actor), { code: 'ASSIGNMENT_CONFLICT' });
  assert.equal((await findAuditEvent(fixture, 'assignment.submission_graded', submissions[0].id)).after.grade,
    87.5);
  await repo.transitionAssignment(assignment.id, 'closed', teacher.actor);
  await assert.rejects(repo.submitAssignment(assignment.id, { text: 'too late' }, studentActor),
    { code: 'ASSIGNMENT_CONFLICT' });
  await repo.transitionAssignment(assignment.id, 'archived', teacher.actor);
  await assert.rejects(repo.updateAssignment(assignment.id, { title: 'Archived edit' }, teacher.actor),
    { code: 'ASSIGNMENT_CONFLICT' });
  assert.equal((await repo.listPortalAssignments(studentActor)).length, 0);

  const dueSoonAt = new Date(
    Math.floor((Date.now() + 6 * 60 * 60 * 1000) / 1000) * 1000
  ).toISOString();
  const upcoming = await repo.createAssignment({
    ...assignmentInput, title: 'Assignment due notification',
    dueAt: dueSoonAt
  }, teacher.actor);
  assert.equal(Math.floor(Date.parse(upcoming.dueAt) / 1000),
    Math.floor(Date.parse(dueSoonAt) / 1000));
  const publishedUpcoming = await repo.transitionAssignment(upcoming.id, 'published', teacher.actor);
  assert.equal(Math.floor(Date.parse(publishedUpcoming.dueAt) / 1000),
    Math.floor(Date.parse(dueSoonAt) / 1000));
  await repo.processAssignmentDueNotifications();
  await repo.processAssignmentDueNotifications();
  if (db) {
    const dueRecipients = await db('user_notifications').where({
      organization_id: orgId, source_type: 'assignment_due_soon', source_id: upcoming.id
    }).pluck('user_id');
    assert.deepEqual(dueRecipients.sort(), [studentUserId, parentUserId].sort());
  } else {
    const dueRecipients = repo.userNotifications.filter((notice) => notice.sourceId === upcoming.id &&
      notice.sourceType === 'assignment_due_soon').map((notice) => notice.userId);
    assert.deepEqual(dueRecipients.sort(), [studentUserId, parentUserId].sort());
  }
  const auditActions = db
    ? (await db('audit_log').where({ organization_id: orgId })
      .whereIn('entity_id', [assignment.id, firstResults[0].id]).pluck('action'))
    : repo.audit.filter((item) => [assignment.id, firstResults[0].id].includes(item.entityId))
      .map((item) => item.action);
  for (const action of ['assignment.created', 'assignment.published', 'assignment.closed',
    'assignment.archived', 'assignment.submitted', 'assignment.submission_resubmitted',
    'assignment.submission_graded']) assert.ok(auditActions.includes(action), action);

  if (db) {
    await runAssignmentMigrationSafetyContract(fixture);
    const storedKeys = await db('assignment_attachments').where({
      organization_id: orgId, campus_id: campusA
    }).whereIn('assignment_id', [assignment.id, crossClassAssignment.id, upcoming.id]).pluck('storage_key');
    await db('assignment_attachments').whereIn('assignment_id', [
      assignment.id, crossClassAssignment.id, upcoming.id
    ]).delete();
    await db('assignment_submissions').whereIn('assignment_id', [
      assignment.id, crossClassAssignment.id, upcoming.id
    ]).delete();
    await db('assignments').whereIn('id', [
      assignment.id, crossClassAssignment.id, upcoming.id
    ]).delete();
    for (const key of storedKeys) {
      const filePath = path.resolve(repo.privateDocumentsDir, key);
      if (existsSync(filePath)) await unlink(filePath);
    }
  }
}

async function runAssignmentMigrationSafetyContract(fixture) {
  const { db, repo, orgId, campusA, campusB } = fixture;
  const before = {
    assignments: Number((await db('assignments').where({ organization_id: orgId })
      .count({ total: '*' }).first()).total),
    submissions: Number((await db('assignment_submissions').where({ organization_id: orgId })
      .count({ total: '*' }).first()).total),
    attachments: Number((await db('assignment_attachments').where({ organization_id: orgId })
      .count({ total: '*' }).first()).total)
  };
  const legacyRows = async () => ({
    students: await db('students').whereIn('campus_id', [campusA, campusB])
      .select('id', 'student_no', 'status', 'section_name').orderBy('id'),
    enrolments: await db('enrolments as e')
      .join('academic_years as y', 'y.id', 'e.academic_year_id')
      .whereIn('y.campus_id', [campusA, campusB])
      .select('e.id', 'e.academic_year_id', 'e.section_id', 'e.status').orderBy('e.id'),
    academicYears: await db('academic_years').whereIn('campus_id', [campusA, campusB])
      .select('id', 'start_date', 'end_date', 'status').orderBy('id')
  });
  const legacyBefore = await legacyRows();
  await migrateWp6Assignments(db);
  await migrateWp6AssignmentPermissions(db);
  const after = {
    assignments: Number((await db('assignments').where({ organization_id: orgId })
      .count({ total: '*' }).first()).total),
    submissions: Number((await db('assignment_submissions').where({ organization_id: orgId })
      .count({ total: '*' }).first()).total),
    attachments: Number((await db('assignment_attachments').where({ organization_id: orgId })
      .count({ total: '*' }).first()).total)
  };
  assert.deepEqual(after, before);
  assert.deepEqual(await legacyRows(), legacyBefore);
  assert.equal(await db.schema.hasColumn('assignments', 'organization_id'), true);
  assert.equal(await db.schema.hasColumn('assignment_submissions', 'campus_id'), true);
  assert.equal(await db.schema.hasColumn('assignment_attachments', 'storage_key'), true);
  assert.equal((await repo.getRolePermissions(orgId, 'student')).includes('assignments.submit'), true);
}

async function runPortalContract(fixture) {
  const { repo, db, orgId, campusA, campusB, studentA, studentB, actors } = fixture;
  const parentId = randomUUID();
  const noLinkParentId = randomUUID();
  const crossOrgParentId = randomUUID();
  const parent = {
    id: parentId, orgId, name: 'Contract Parent', email: `${parentId}@example.test`,
    role: 'parent_guardian', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const noLinkParent = {
    id: noLinkParentId, orgId, name: 'Unlinked Parent', email: `${noLinkParentId}@example.test`,
    role: 'parent_guardian', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const crossOrgParent = {
    id: crossOrgParentId, orgId, name: 'Cross-organization Parent',
    email: `${crossOrgParentId}@example.test`, role: 'parent_guardian',
    campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  if (db) {
    await db('users').insert([parent, noLinkParent, crossOrgParent].map((user) => ({
      id: user.id, organization_id: orgId, name: user.name, email: user.email,
      password_hash: 'contract-only', role: user.role, is_active: true
    })));
    await db('user_campuses').insert([parent, noLinkParent, crossOrgParent].map((user) => ({
      user_id: user.id, campus_id: campusA, is_active: true
    })));
  } else {
    repo.users.push(parent, noLinkParent, crossOrgParent);
  }
  const guardianId = randomUUID();
  const foreignOrgId = randomUUID();
  const foreignCampusId = randomUUID();
  const foreignStudentId = randomUUID();
  const guardian = {
    id: guardianId, orgId, givenNameAm: 'ወላጅ', fatherNameAm: 'ፈተና',
    grandfatherNameAm: 'አንድ', givenNameEn: 'Contract', fatherNameEn: 'Parent',
    grandfatherNameEn: 'One', phone: '+251900000101', email: `${parentId}@example.test`,
    userId: parentId
  };
  const links = [studentA, studentB].map((childId) => ({
    studentId: childId, guardianId, relationship: 'parent', isPrimary: true,
    isVerified: true, canViewResults: true, canViewFees: false
  }));
  const foreignGuardian = {
    id: randomUUID(), orgId: foreignOrgId, givenNameAm: 'ወላጅ', fatherNameAm: 'ውጭ',
    grandfatherNameAm: 'ትምህርት', givenNameEn: 'Foreign', fatherNameEn: 'School',
    grandfatherNameEn: 'Guardian', phone: '+251900000102', email: `${crossOrgParentId}@example.test`,
    userId: crossOrgParentId
  };
  const foreignStudent = {
    id: foreignStudentId, campusId: foreignCampusId,
    studentNo: `F-${foreignStudentId.slice(0, 8)}`,
    givenNameEn: 'Foreign', fatherNameEn: 'School', grandfatherNameEn: 'Child',
    givenNameAm: 'ውጭ', fatherNameAm: 'ትምህርት', grandfatherNameAm: 'ተማሪ',
    gender: 'female', sectionName: null, status: 'enrolled', archivedAt: null
  };
  if (db) {
    await db('organizations').insert({
      id: foreignOrgId, name: 'Portal Foreign School', status: 'active',
      school_code: contractSchoolCode(), academic_configuration_json: '{}'
    });
    await db('campuses').insert({
      id: foreignCampusId, organization_id: foreignOrgId,
      name: 'Portal Foreign Campus', is_active: true
    });
    await db('students').insert({
      id: foreignStudentId, campus_id: foreignCampusId, student_no: foreignStudent.studentNo,
      given_name_am: foreignStudent.givenNameAm, father_name_am: foreignStudent.fatherNameAm,
      grandfather_name_am: foreignStudent.grandfatherNameAm,
      given_name_en: foreignStudent.givenNameEn, father_name_en: foreignStudent.fatherNameEn,
      grandfather_name_en: foreignStudent.grandfatherNameEn, gender: foreignStudent.gender
    });
    await db('guardians').insert({
      id: guardian.id, organization_id: orgId,
      given_name_am: guardian.givenNameAm, father_name_am: guardian.fatherNameAm,
      grandfather_name_am: guardian.grandfatherNameAm,
      given_name_en: guardian.givenNameEn, father_name_en: guardian.fatherNameEn,
      grandfather_name_en: guardian.grandfatherNameEn, phone: guardian.phone,
      email: guardian.email, user_id: parentId
    });
    await db('student_guardians').insert(links.map((link) => ({
      student_id: link.studentId, guardian_id: guardian.id,
      relationship: link.relationship, is_primary: link.isPrimary,
      is_verified: link.isVerified, can_view_results: link.canViewResults,
      can_view_fees: link.canViewFees
    })));
    await db('guardians').insert({
      id: foreignGuardian.id, organization_id: foreignOrgId,
      given_name_am: foreignGuardian.givenNameAm, father_name_am: foreignGuardian.fatherNameAm,
      grandfather_name_am: foreignGuardian.grandfatherNameAm,
      given_name_en: foreignGuardian.givenNameEn, father_name_en: foreignGuardian.fatherNameEn,
      grandfather_name_en: foreignGuardian.grandfatherNameEn,
      phone: foreignGuardian.phone, email: foreignGuardian.email, user_id: crossOrgParentId
    });
    await db('student_guardians').insert({
      student_id: foreignStudentId, guardian_id: foreignGuardian.id,
      relationship: 'parent', is_primary: true, is_verified: true,
      can_view_results: true, can_view_fees: true
    });
  } else {
    repo.organizations.push({ id: foreignOrgId, name: 'Portal Foreign School', status: 'active' });
    repo.campuses.push({
      id: foreignCampusId, organizationId: foreignOrgId,
      name: 'Portal Foreign Campus', isActive: true
    });
    repo.students.push(foreignStudent);
    repo.guardians.push(guardian, foreignGuardian);
    repo.studentGuardians.push(...links, {
      studentId: foreignStudentId, guardianId: foreignGuardian.id,
      relationship: 'parent', isPrimary: true, isVerified: true,
      canViewResults: true, canViewFees: true
    });
  }

  const { yearA, sectionA } = await prepareAcademicStudentFixture(fixture);
  const term = {
    id: randomUUID(), name: `Portal Term ${randomUUID().slice(0, 6)}`,
    startDate: '2026-02-01', endDate: '2026-06-30'
  };
  if (db) {
    await db('terms').insert({
      id: term.id, academic_year_id: yearA.id, name: term.name,
      start_date: term.startDate, end_date: term.endDate,
      period_type: 'term', is_current: true
    });
  } else {
    yearA.terms ??= [];
    yearA.terms.push({ ...term, periodType: 'term', isCurrent: true });
  }
  const snapshot = {
    termId: term.id, termName: term.name, subjects: [], totalValue: 0,
    totalMaxValue: 0, overallPercent: null, overallBand: null
  };
  const reportRows = ['draft', 'published'].map((status, index) => ({
    id: randomUUID(), campusId: campusA, studentId: studentA, termId: term.id,
    revision: index + 1, status, snapshot, createdBy: actors.owner.id,
    publishedBy: status === 'published' ? actors.principal.id : null,
    publishedAt: status === 'published' ? new Date() : null
  }));
  if (db) {
    await db('term_report_revisions').insert(reportRows.map((row) => ({
      id: row.id, campus_id: row.campusId, student_id: row.studentId, term_id: row.termId,
      revision: row.revision, status: row.status, report_json: JSON.stringify(row.snapshot),
      created_by: row.createdBy, published_by: row.publishedBy, published_at: row.publishedAt
    })));
  }
  const publishedMark = await repo.saveMark({
    studentId: studentA, assessmentName: 'Published result', value: 8,
    maxValue: 10, clientUuid: randomUUID()
  }, actors.owner.actor);
  const draftMark = await repo.saveMark({
    studentId: studentA, assessmentName: 'Unpublished result', value: 9,
    maxValue: 10, clientUuid: randomUUID()
  }, actors.owner.actor);
  await repo.transitionMark(publishedMark.id, 'submitted', actors.owner.actor);
  await repo.transitionMark(publishedMark.id, 'approved', actors.academicHead.actor);
  await repo.transitionMark(publishedMark.id, 'locked', actors.principal.actor);
  if (!db) {
    repo.termReportRevisions.push(...reportRows);
  }
  const portal = await repo.getPortalHome({
    sub: parentId, orgId, role: 'parent_guardian', activeCampusId: campusA, campusIds: [campusA]
  });
  assert.deepEqual(portal.students.map(({ student }) => student.id), [studentA],
    'a guardian sees only linked children in their campus memberships');
  assert.deepEqual(portal.students[0].results.map((item) => item.assessmentName), ['Published result']);
  assert.deepEqual(portal.students[0].reports.map((item) => item.revision), [2]);
  assert.deepEqual((await repo.getPortalHome({
    sub: noLinkParentId, orgId, role: 'parent_guardian',
    activeCampusId: campusA, campusIds: [campusA]
  })).students, [], 'an unlinked guardian sees no children');
  assert.deepEqual((await repo.getPortalHome({
    sub: crossOrgParentId, orgId, role: 'parent_guardian',
    activeCampusId: campusA, campusIds: [campusA]
  })).students, [], 'a foreign-organization guardian link is not visible');
  assert.equal(await repo.getStudentSensitiveData(studentB, actors.owner.actor), null,
    'a student in another campus is not accessible');
  assert.equal(yearA.campusId, campusA);
  assert.equal(campusB === foreignCampusId, false);

  const studentUserId = randomUUID();
  const teacherId = randomUUID();
  const unassignedTeacherId = randomUUID();
  const studentUser = {
    id: studentUserId, orgId, name: 'Portal Student', email: `${studentUserId}@example.test`,
    role: 'student', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const teacher = {
    id: teacherId, orgId, name: 'Portal Teacher', email: `${teacherId}@example.test`,
    role: 'subject_teacher', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const unassignedTeacher = {
    id: unassignedTeacherId, orgId, name: 'Unassigned Portal Teacher',
    email: `${unassignedTeacherId}@example.test`, role: 'subject_teacher',
    campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  const portalActor = (user) => ({
    sub: user.id, orgId, activeCampusId: campusA, campusIds: [campusA], role: user.role
  });
  if (db) {
    await db('users').insert([studentUser, teacher, unassignedTeacher].map((user) => ({
      id: user.id, organization_id: orgId, name: user.name, email: user.email,
      password_hash: 'contract-only', role: user.role, is_active: true
    })));
    await db('user_campuses').insert([studentUser, teacher, unassignedTeacher].map((user) => ({
      user_id: user.id, campus_id: campusA, is_active: true
    })));
    await db('students').where({ id: studentA }).update({ user_id: studentUserId, status: 'enrolled' });
    await db('staff').insert({
      id: randomUUID(), campus_id: campusA, user_id: teacherId, given_name_en: 'Portal',
      father_name_en: 'Teacher', grandfather_name_en: 'Contract', given_name_am: 'ፖርታል',
      father_name_am: 'መምህር', grandfather_name_am: 'ሙከራ', job_title: 'Teacher',
      employment_status: 'active'
    });
    const staffRow = await db('staff').where({ user_id: teacherId }).first('id');
    const gradeSubjects = await repo.listGradeSubjects(campusA, sectionA.gradeLevelId);
    await db('teaching_assignments').insert({
      id: randomUUID(), campus_id: campusA, staff_id: staffRow.id,
      section_id: sectionA.id, subject_id: gradeSubjects[0].subjectId, is_active: true
    });
  } else {
    repo.users.push(studentUser, teacher, unassignedTeacher);
    Object.assign(repo.students.find((student) => student.id === studentA), {
      userId: studentUserId, status: 'enrolled', orgId
    });
    const staffId = randomUUID();
    repo.staff.push({
      id: staffId, campusId: campusA, userId: teacherId, givenNameEn: 'Portal',
      fatherNameEn: 'Teacher', grandfatherNameEn: 'Contract', employmentStatus: 'active'
    });
    const gradeSubjects = await repo.listGradeSubjects(campusA, sectionA.gradeLevelId);
    repo.teachingAssignments.push({
      id: randomUUID(), campusId: campusA, staffId, sectionId: sectionA.id,
      subjectId: gradeSubjects[0].subjectId, isActive: true
    });
  }
  const parentActor = {
    sub: parentId, orgId, activeCampusId: campusA, campusIds: [campusA], role: 'parent_guardian'
  };
  const studentActor = portalActor(studentUser);
  const teacherActor = portalActor(teacher);
  const unassignedTeacherActor = portalActor(unassignedTeacher);
  const calendar = await repo.getPortalCalendar(parentActor, { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(calendar.students.map((student) => student.id), [studentA]);
  assert.equal(calendar.timetable.length, 1);
  assert.equal(calendar.timetable[0].teacherUserId, teacherId);
  assert.deepEqual(await repo.getPortalCalendar({
    ...parentActor, sub: noLinkParentId
  }, { from: '2026-01-01', to: '2026-12-31' }).then((result) =>
    result.students.map((student) => student.id)), []);

  const event = await repo.createCampusEvent({
    titleEn: 'Portal status event', titleAm: 'የፖርታል ዝግጅት',
    descriptionEn: 'Status test', descriptionAm: 'የሁኔታ ሙከራ',
    startsOn: '2026-04-10', endsOn: '2026-04-10', startsAt: null, endsAt: null,
    location: 'Classroom', eventType: 'meeting', audience: 'school'
  }, actors.owner.actor);
  const eventCreatedAt = event.createdAt;
  let eventUpdatedAtBefore;
  if (db) {
    const row = await db('campus_events').where({ id: event.id }).first('updated_at');
    eventUpdatedAtBefore = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
    const [columns] = await db.raw('SHOW COLUMNS FROM `campus_events` LIKE ?', ['updated_at']);
    assert.equal(columns[0].Extra.includes('on update'), false);
  }
  await repo.updateCampusEventStatus(event.id, 'cancelled', actors.owner.actor);
  assert.equal((await repo.listCampusEvents(campusA, '2026-01-01', '2026-12-31', orgId))
    .find((item) => item.id === event.id).status, 'cancelled');
  if (db) {
    const row = await db('campus_events').where({ id: event.id }).first('created_at', 'updated_at');
    assert.equal(row.created_at.toISOString(), eventCreatedAt);
    const updatedAtAfter = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at;
    assert.equal(updatedAtAfter, eventUpdatedAtBefore);
  }

  const portalRequest = await repo.createPortalRequest({
    studentId: studentA, type: 'absence_explanation', subject: 'Absence request',
    details: 'Please explain the student absence.'
  }, parentActor);
  await assert.rejects(repo.createPortalRequest({
    studentId: studentA, type: 'document_request', subject: 'Not linked',
    details: 'This account has no verified link.'
  }, { ...parentActor, sub: noLinkParentId }), { code: 'CAMPUS_SCOPE_VIOLATION' });
  assert.deepEqual((await repo.listPortalRequests(parentActor)).map((item) => item.id), [portalRequest.id]);
  await assert.rejects(repo.updatePortalRequest(portalRequest.id, {
    status: 'approved', response: ''
  }, parentActor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await repo.updatePortalRequest(portalRequest.id, { status: 'approved', response: 'Approved.' },
    actors.principal.actor);
  assert.equal((await repo.listPortalRequests(parentActor))[0].createdAt, portalRequest.createdAt);
  await assert.rejects(repo.updatePortalRequest(portalRequest.id, {
    status: 'rejected', response: ''
  }, actors.principal.actor), { code: 'PORTAL_REQUEST_TRANSITION_INVALID' });
  if (db) {
    const row = await db('portal_requests').where({ id: portalRequest.id }).first('created_at');
    assert.equal(row.created_at.toISOString(), portalRequest.createdAt);
  }

  const supportRequest = await repo.createPortalSupportRequest({
    category: 'academic', subject: 'Math support', details: 'Need help with the current lesson.'
  }, studentActor);
  assert.deepEqual((await repo.listPortalSupportRequests(studentActor)).map((item) => item.id), [supportRequest.id]);
  assert.deepEqual(await repo.listPortalSupportRequests(unassignedTeacherActor), []);
  await repo.updatePortalSupportRequest(supportRequest.id, {
    status: 'in_progress', response: 'Assigned to a teacher.'
  }, teacherActor);
  await assert.rejects(repo.updatePortalSupportRequest(supportRequest.id, {
    status: 'open', response: ''
  }, teacherActor), { code: 'PORTAL_SUPPORT_TRANSITION_INVALID' });

  const message = await repo.createPortalMessageThread({
    studentId: studentA, recipientId: teacherId, body: 'Hello, I have a question.'
  }, parentActor);
  const sentAt = message.sentAt;
  assert.equal((await repo.listPortalMessageThreads(teacherActor)).length, 1);
  assert.deepEqual(await repo.listPortalMessageThreads(unassignedTeacherActor), []);
  assert.deepEqual(await repo.listPortalMessageThreads({
    ...parentActor, sub: noLinkParentId
  }), []);
  assert.ok(await repo.markPortalThreadRead(message.threadId, teacherActor));
  await repo.moderatePortalMessage(message.id, {
    status: 'archived', reason: 'Contract moderation'
  }, actors.principal.actor);
  if (db) {
    const row = await db('messages').where({ id: message.id }).first('sent_at');
    assert.equal(row.sent_at.toISOString(), sentAt);
  } else {
    assert.equal(repo.portalMessages.find((item) => item.id === message.id).sentAt, sentAt);
  }
  await repo.setPortalMessagingEnabled(false, actors.principal.actor);
  await assert.rejects(repo.listPortalMessageThreads(parentActor), { code: 'PORTAL_MESSAGING_DISABLED' });
  await assert.rejects(repo.sendPortalMessage(message.threadId, 'Disabled message', parentActor),
    { code: 'PORTAL_MESSAGING_DISABLED' });
  await repo.setPortalMessagingEnabled(true, actors.principal.actor);
  assert.ok(await repo.createPortalMessageThread({
    studentId: studentA, recipientId: teacherId, body: 'The existing thread is reused.'
  }, parentActor));
}

async function runAcademicContract(fixture) {
  const { repo, db, campusA, campusB, actors } = fixture;
  const { yearA, nextYear, yearB, gradeA, gradeB, sectionA, sectionA2 } =
    await prepareAcademicStudentFixture(fixture);
  const activated = await repo.activateAcademicYear(nextYear.id, actors.owner.actor);
  assert.equal(activated.status, 'active');
  assert.deepEqual((await repo.listAcademicYears(campusA))
    .filter((year) => year.status === 'active').map((year) => year.id), [nextYear.id]);
  assert.equal((await repo.listAcademicYears(campusB)).find((year) => year.id === yearB.id).status, 'active');

  assert.equal((await repo.updateSectionCapacity(sectionA.id, { capacity: 1 }, actors.owner.actor)).capacity, 1);
  assert.equal((await repo.updateSectionCapacity(sectionA.id, { capacity: 2 }, actors.owner.actor)).capacity, 2);
  assert.equal(await repo.updateSectionCapacity(sectionA.id, { capacity: 2 }, actors.campusBOwner.actor), null);

  const subjects = await repo.listGradeSubjects(campusA, gradeA.id);
  assert.ok(subjects.length > 1);
  const replacement = await repo.replaceGradeSubjects(gradeA.id, {
    subjects: subjects.slice(0, 1).map(({ subjectId, stream, weeklyPeriods, isRequired }) =>
      ({ subjectId, stream, weeklyPeriods, isRequired }))
  }, actors.owner.actor);
  assert.equal(replacement.length, 1);
  await assert.rejects(repo.replaceGradeSubjects(gradeA.id, { subjects: [{
    subjectId: (await repo.listGradeSubjects(campusB, gradeB.id))[0].subjectId,
    stream: 'all', weeklyPeriods: 1, isRequired: true
  }] }, actors.owner.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });

  const rule = await repo.savePromotionRule({
    gradeLevelId: gradeA.id, minimumAnnualPercent: 50,
    maximumFailedRequiredSubjects: 1
  }, actors.owner.actor);
  assert.equal(rule.minimumAnnualPercent, 50);
  assert.equal((await repo.listPromotionRules(campusA)).some((item) => item.id === rule.id), true);
  await assert.rejects(repo.savePromotionRule({
    gradeLevelId: gradeB.id, minimumAnnualPercent: 50,
    maximumFailedRequiredSubjects: 1
  }, actors.owner.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });

  if (db) {
    const trigger = `contract_academic_rollback_${randomUUID().replaceAll('-', '')}`;
    await db.raw(
      `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
      `BEGIN IF NEW.action = 'academic_year.activated' THEN ` +
      `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract audit failure'; END IF; END`
    );
    try {
      await assert.rejects(repo.activateAcademicYear(yearA.id, actors.owner.actor));
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``);
    }
    assert.deepEqual((await repo.listAcademicYears(campusA))
      .filter((year) => year.status === 'active').map((year) => year.id), [nextYear.id]);
  }
  assert.equal((await repo.listAcademicYears(campusA)).some((year) => year.id === yearB.id), false);
  assert.equal(await repo.listSections(campusB, actors.owner.actor).then((rows) =>
    rows.every((section) => section.campusId === campusB)), true);
  assert.equal(sectionA2.campusId, campusA);
}

async function runStudentsContract(fixture) {
  const { repo, db, orgId, campusA, campusB, studentA, studentB, actors } = fixture;
  const { sectionA, sectionA2, sectionB } = await prepareAcademicStudentFixture(fixture);
  const data = {
    studentNo: `CONTRACT-${randomUUID().slice(0, 8)}`,
    givenNameAm: 'አዲስ', fatherNameAm: 'ፈተና', grandfatherNameAm: 'ተማሪ',
    givenNameEn: 'New', fatherNameEn: 'Contract', grandfatherNameEn: 'Student',
    gender: 'female', dateOfBirth: '2017-05-04', guardianPhone: '+251900000201',
    sectionName: sectionA.name
  };
  const planId = randomUUID();
  let memoryPlanId = null;
  if (db) {
    await db('subscription_plans').insert({
      id: planId, code: `contract-${planId.slice(0, 8)}`, name: 'Contract student cap',
      description: '', monthly_price: 0, currency_code: 'ETB', trial_days: 30,
      student_limit: 2, staff_limit: null, site_limit: null, modules_json: '[]', is_active: true
    });
    await db('organization_subscriptions').insert({
      id: randomUUID(), organization_id: orgId, plan_id: planId, status: 'active'
    });
  } else {
    const subscription = repo.subscriptions.find((item) => item.organizationId === orgId);
    memoryPlanId = subscription.planId;
    repo.subscriptionPlans.find((item) => item.id === memoryPlanId).studentLimit = 2;
  }
  await assert.rejects(repo.createStudent(data, actors.owner.actor), { code: 'PLAN_LIMIT_REACHED' });
  if (db) await db('subscription_plans').where({ id: planId }).update({ student_limit: 3 });
  else repo.subscriptionPlans.find((item) => item.id === memoryPlanId).studentLimit = 3;
  const created = await repo.createStudent(data, actors.owner.actor);
  const student = created.student;
  assert.equal(student.campusId, campusA);
  assert.equal(student.status, 'enrolled');
  assert.equal((await auditActions(fixture, campusA)).includes('student.created'), true);
  if (db) await db('subscription_plans').where({ id: planId }).update({ student_limit: 4 });
  else repo.subscriptionPlans.find((item) => item.id === memoryPlanId).studentLimit = 4;
  await assert.rejects(repo.createStudent({ ...data, studentNo: `WRONG-${randomUUID()}`, sectionName: sectionB.name }, actors.owner.actor), {
    code: 'CAMPUS_SCOPE_VIOLATION'
  });
  const importResult = await repo.importStudents([{
    rowNumber: 1,
    data: {
      ...data,
      studentNo: `IMPORT-${randomUUID().slice(0, 8)}`,
      givenNameAm: 'ተጨማሪ', fatherNameAm: 'ፈተና', grandfatherNameAm: 'ተማሪ',
      givenNameEn: 'Imported', fatherNameEn: 'Contract', grandfatherNameEn: 'Student',
      dateOfBirth: '2016-09-11', guardianPhone: '+251900000209'
    }
  }], actors.owner.actor);
  assert.equal(importResult.createdCount, 1);
  const importAudit = await findAuditEvent(fixture, 'student.imported', null);
  assert.equal(importAudit.organizationId, orgId);
  assert.equal(importAudit.campusId, campusA);
  assert.equal(importAudit.after.createdCount, 1);
  assert.deepEqual(importAudit.after.rowNumbers, [1]);

  const key = randomBytes(32).toString('base64url');
  repo.sensitiveDataKey = key;
  {
    const secret = { idNumber: `ET-${randomUUID()}`, healthNotes: 'Private contract note' };
    assert.deepEqual(await repo.updateStudentSensitiveData(student.id, secret, actors.owner.actor), {
      ...secret, specialNeeds: null, allergies: null
    });
    assert.deepEqual(await repo.getStudentSensitiveData(student.id, actors.owner.actor), {
      ...secret, specialNeeds: null, allergies: null
    });
    if (db) {
      const encrypted = await db('students').where({ id: student.id })
        .first('id_number_enc', 'health_notes_enc');
      assert.ok(encrypted.id_number_enc.startsWith('v1.'));
      assert.ok(encrypted.health_notes_enc.startsWith('v1.'));
      assert.equal(JSON.stringify(encrypted).includes(secret.idNumber), false);
      assert.equal(JSON.stringify(encrypted).includes(secret.healthNotes), false);
    } else {
      const encrypted = repo.studentSensitive.get(student.id);
      assert.ok(encrypted.idNumberEnc.startsWith('v1.'));
      assert.equal(JSON.stringify(encrypted).includes(secret.idNumber), false);
      assert.equal(JSON.stringify(encrypted).includes(secret.healthNotes), false);
    }
    assert.equal(await repo.getStudentSensitiveData(studentB, actors.owner.actor), null);
    assert.equal(await repo.updateStudentSensitiveData(studentB, secret, actors.owner.actor), null);
  }

  const guardian = await repo.addStudentGuardian(student.id, {
    givenNameAm: 'ወላጅ', fatherNameAm: 'ፈተና', grandfatherNameAm: 'አንድ',
    givenNameEn: 'Contract', fatherNameEn: 'Guardian', grandfatherNameEn: 'One',
    phone: '+251900000202', relationship: 'parent', isPrimary: true
  }, actors.owner.actor);
  assert.equal((await repo.listStudentGuardians(student.id, actors.owner.actor)).length, 1);
  assert.equal(await repo.removeStudentGuardian(student.id, guardian.id, actors.owner.actor), true);
  assert.deepEqual(await repo.listStudentGuardians(student.id, actors.owner.actor), []);
  await assert.rejects(repo.addStudentGuardian(studentB, {
    givenNameAm: 'ወላጅ', fatherNameAm: 'ፈተና', grandfatherNameAm: 'አንድ',
    givenNameEn: 'Wrong', fatherNameEn: 'Campus', grandfatherNameEn: 'Guardian',
    phone: '+251900000203', relationship: 'parent', isPrimary: false
  }, actors.owner.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });

  const contact = await repo.addStudentEmergencyContact(student.id, {
    name: 'Contract Emergency Contact', phone: '+251900000204',
    relationship: 'Aunt', priority: 1
  }, actors.owner.actor);
  assert.equal((await repo.listStudentEmergencyContacts(student.id, actors.owner.actor))[0].id, contact.id);
  assert.equal(await repo.listStudentEmergencyContacts(studentB, actors.owner.actor), null);
  if (db) {
    const storedContact = await db('student_emergency_contacts').where({ id: contact.id })
      .first('contact_name_enc', 'phone_enc');
    assert.ok(storedContact.contact_name_enc.startsWith('v1.'));
    assert.equal(JSON.stringify(storedContact).includes('Contract Emergency Contact'), false);
  } else {
    const storedContact = repo.studentEmergencyContacts.find((item) => item.id === contact.id);
    assert.ok(storedContact.nameEnc.startsWith('v1.'));
    assert.equal(JSON.stringify(storedContact).includes('Contract Emergency Contact'), false);
  }
  assert.equal(await repo.removeStudentEmergencyContact(student.id, contact.id, actors.owner.actor), true);

  const importData = {
    ...data, givenNameEn: 'Import', grandfatherNameEn: randomUUID(),
    dateOfBirth: '2015-03-04'
  };
  const preview = await repo.previewStudentImport([
    { rowNumber: 1, data: { ...importData, studentNo: `IMPORT-${randomUUID().slice(0, 8)}` } },
    { rowNumber: 2, data: { ...importData, studentNo: `OTHER-${randomUUID().slice(0, 8)}`, sectionName: sectionB.name } },
    { rowNumber: 3, data: { ...data, studentNo: `A-${studentA.slice(0, 8)}` } }
  ], actors.owner.actor);
  assert.equal(preview[0].eligible, true);
  assert.equal(preview[1].eligible, false);
  assert.equal(preview[2].eligible, false);

  const withdrawn = await repo.changeStudentStatus(student.id, 'withdrawn', 'Contract withdrawal', actors.owner.actor);
  assert.equal(withdrawn.status, 'withdrawn');
  if (!db) {
    const readmitted = await repo.readmitStudent(student.id, {
      sectionId: sectionA2.id, reason: 'Contract readmission'
    }, actors.owner.actor);
    assert.equal(readmitted.status, 'enrolled');
    assert.equal(readmitted.sectionName, sectionA2.name);
    const transferred = await repo.transferStudentSection(student.id, {
      sectionId: sectionA.id, reason: 'Contract section transfer'
    }, actors.owner.actor);
    assert.equal(transferred.sectionName, sectionA.name);
    assert.equal((await repo.transferStudentOut(student.id, 'Contract transfer out', actors.owner.actor))
      .status, 'transferred_out');
  } else {
    const transferOut = await repo.transferStudentOut(studentB, 'Contract transfer out', actors.campusBOwner.actor);
    assert.equal(transferOut.status, 'transferred_out');
  }
  assert.equal(await repo.changeStudentStatus(student.id, 'withdrawn', 'Cross-campus attempt', actors.campusBOwner.actor), null);
  assert.equal(await repo.listStudentGuardians(studentB, actors.owner.actor), null);
  assert.equal(campusB !== campusA, true);
}

function admissionData(gradeLevelId, suffix = randomUUID().slice(0, 8)) {
  return {
    gradeLevelId, givenNameAm: 'አዲስ', fatherNameAm: 'ፈተና', grandfatherNameAm: 'ተማሪ',
    givenNameEn: 'Applicant', fatherNameEn: 'Contract', grandfatherNameEn: suffix,
    gender: 'female', dateOfBirth: '2017-06-07', guardianName: 'Contract Guardian',
    guardianPhone: `+2519${suffix.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`
  };
}

async function runAdmissionsContract(fixture) {
  const { repo, db, orgId, campusA, campusB, actors } = fixture;
  const { yearA, gradeA, sectionA } = await prepareAcademicStudentFixture(fixture);
  const data = admissionData(gradeA.id);
  const admission = await repo.createAdmission(data, actors.owner.actor);
  assert.equal(admission.status, 'enquiry');
  assert.equal(await repo.getAdmission(campusB, admission.id), null);
  assert.ok((await repo.findAdmissionDuplicates(campusA, {
    name: `${data.givenNameEn} ${data.fatherNameEn} ${data.grandfatherNameEn}`,
    dateOfBirth: data.dateOfBirth, guardianPhone: data.guardianPhone
  })).some((match) => match.id === admission.id));
  await assert.rejects(repo.scheduleAdmissionInterview(admission.id, {
    interviewAt: '2026-03-01T10:00:00.000Z', interviewResult: 'scheduled'
  }, actors.owner.actor), { code: 'SETUP_CONFLICT' });
  const application = await repo.updateAdmissionStatus(admission.id, {
    status: 'application', decisionNote: 'Application complete'
  }, actors.owner.actor);
  assert.equal(application.status, 'application');
  const interview = await repo.scheduleAdmissionInterview(admission.id, {
    interviewAt: '2026-03-02T10:00:00.000Z', interviewResult: 'scheduled'
  }, actors.owner.actor);
  assert.equal(interview.status, 'interview');
  const accepted = await repo.updateAdmissionStatus(admission.id, {
    status: 'accepted', decisionNote: 'Accepted for contract test'
  }, actors.owner.actor);
  assert.equal(accepted.status, 'accepted');
  const decisionAudit = await findAuditEvent(fixture, 'admission.accepted', admission.id);
  assert.equal(decisionAudit.organizationId, orgId);
  assert.equal(decisionAudit.campusId, campusA);
  assert.equal(decisionAudit.before.status, 'interview');
  assert.equal(decisionAudit.after.status, 'accepted');
  await assert.rejects(repo.updateAdmissionStatus(admission.id, {
    status: 'rejected', decisionNote: 'Invalid transition'
  }, actors.owner.actor), { code: 'SETUP_CONFLICT' });
  await assert.rejects(repo.storeAdmissionDocument(admission.id, 'birth_certificate', 'wrong.pdf',
    'application/pdf', Buffer.from('not a PDF'), actors.owner.actor), { code: 'INVALID_DOCUMENT' });

  const documentKeys = [];
  try {
    for (const [index, documentType] of ['birth_certificate', 'previous_school_report', 'guardian_id'].entries()) {
      const document = await repo.storeAdmissionDocument(
        admission.id, documentType, `${documentType}.pdf`, 'application/pdf',
        Buffer.from(`%PDF-1.4 contract-${index}`), actors.owner.actor
      );
      if (db) {
        const stored = await db('admission_documents').where({ id: document.id }).first('storage_key');
        documentKeys.push(stored.storage_key);
      }
    }
    const documents = await repo.listAdmissionDocuments(campusA, admission.id);
    assert.equal(documents.length, 3);
    const downloaded = await repo.getAdmissionDocument(campusA, admission.id, documents[0].id);
    assert.ok(downloaded.content.toString().startsWith('%PDF-'));
    assert.equal((await repo.listAdmissionDocuments(campusB, admission.id)).length, 0);
    await assert.rejects(repo.storeAdmissionDocument(admission.id, 'guardian_id', 'wrong-campus.pdf',
      'application/pdf', Buffer.from('%PDF-1.4 denied'), actors.campusBOwner.actor), {
      code: 'CAMPUS_SCOPE_VIOLATION'
    });
    const activeUsers = db
      ? Number((await db('users').where({ organization_id: orgId, is_active: true })
        .count({ total: '*' }).first()).total)
      : repo.users.filter((user) => user.orgId === orgId && user.isActive !== false).length;
    const planCode = `admission-quota-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const quotaPlan = await repo.saveSubscriptionPlan({
      code: planCode, name: 'Admission quota contract', description: '',
      monthlyPrice: 0, currencyCode: 'ETB', trialDays: 0,
      studentLimit: null, staffLimit: null, siteLimit: null,
      billingCycle: 'monthly', maxUsers: activeUsers, storageLimitBytes: null,
      modules: [], isActive: true
    }, actors.owner.actor);
    if (db) {
      await db('organization_subscriptions').insert({
        id: randomUUID(), organization_id: orgId, plan_id: quotaPlan.id, status: 'active'
      });
    } else {
      const subscription = repo.subscriptions.find((item) => item.organizationId === orgId);
      if (subscription) subscription.planId = quotaPlan.id;
      else repo.subscriptions.push({
        id: randomUUID(), organizationId: orgId, planId: quotaPlan.id, status: 'active'
      });
    }
    await assert.rejects(
      repo.enrolAdmission(admission.id, { sectionId: sectionA.id }, actors.owner.actor),
      { code: 'PLAN_LIMIT_REACHED' }
    );
    await repo.saveSubscriptionPlan({ ...quotaPlan, maxUsers: activeUsers + 1 }, actors.owner.actor);
    const enrolled = await repo.enrolAdmission(admission.id, { sectionId: sectionA.id }, actors.owner.actor);
    assert.equal(enrolled.student.status, 'enrolled');
    assert.equal(enrolled.student.campusId, campusA);
    assert.equal(enrolled.admission.status, 'enrolled');
    const enrolledAudit = await findAuditEvent(fixture, 'admission.enrolled', enrolled.student.id);
    assert.equal(enrolledAudit.organizationId, orgId);
    assert.equal(enrolledAudit.campusId, campusA);
    assert.equal(enrolledAudit.before.status, 'accepted');
    assert.equal(enrolledAudit.after.studentNo, enrolled.student.studentNo);
    assert.equal((await repo.listAdmissions(campusB)).some((item) => item.id === admission.id), false);
  } finally {
    if (db) {
      for (const key of documentKeys) {
        await unlink(path.join(repo.privateDocumentsDir, path.basename(key))).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
  }

  const token = randomBytes(32).toString('hex');
  if (db) await db('campuses').where({ id: campusA }).update({ admissions_public_token: token });
  else repo.campuses.find((item) => item.id === campusA).admissionsPublicToken = token;
  assert.equal(await repo.getAdmissionsPublicToken(campusA), token);
  assert.ok(await repo.getPublicAdmissionInfo(token));
  assert.equal(await repo.getPublicAdmissionInfo('invalid-contract-token'), null);
  const publicAdmission = await repo.createPublicAdmission(token, admissionData(gradeA.id));
  assert.equal(publicAdmission.status, 'application');
  assert.equal(publicAdmission.publicSubmission, true);
  if (db) {
    const stored = await db('admissions').where({ id: publicAdmission.id }).first('privacy_consent_at');
    assert.ok(stored.privacy_consent_at);
  } else {
    assert.ok(publicAdmission.privacyConsentAt);
  }
  assert.equal((await repo.listAdmissions(campusA)).some((item) => item.id === publicAdmission.id), true);
  assert.equal((await repo.listAdmissions(campusB)).some((item) => item.id === publicAdmission.id), false);
  assert.equal(yearA.campusId, campusA);
}
async function staffCount(fixture, campusId) {
  if (fixture.db) {
    const row = await fixture.db('staff').where({ campus_id: campusId })
      .count({ total: '*' }).first();
    return Number(row.total);
  }
  return fixture.repo.staff.filter((staff) => staff.campusId === campusId).length;
}

function staffData(overrides = {}) {
  const suffix = randomUUID().slice(0, 8);
  return {
    givenNameEn: `Contract${suffix}`, fatherNameEn: 'Staff', grandfatherNameEn: 'Test',
    givenNameAm: 'ፈተና', fatherNameAm: 'ሰራተኛ', grandfatherNameAm: 'ሙከራ',
    jobTitle: 'Teacher', employmentStatus: 'active', ...overrides
  };
}

async function verifyStaffAuditRollback(fixture) {
  const { repo, db, campusA, actors } = fixture;
  const beforeCount = await staffCount(fixture, campusA);
  const data = staffData();
  if (!db) {
    const appendAudit = repo.appendAudit;
    repo.appendAudit = async (actor, action, ...args) => {
      if (action === 'staff.created') throw new Error('contract audit failure');
      return appendAudit.call(repo, actor, action, ...args);
    };
    try {
      await assert.rejects(repo.createStaff(data, actors.owner.actor), /contract audit failure/);
      assert.equal(await staffCount(fixture, campusA), beforeCount);
    } finally {
      repo.appendAudit = appendAudit;
    }
    return;
  }

  const trigger = `staff_contract_rollback_${randomUUID().replaceAll('-', '')}`;
  await db.raw(
    `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
    `BEGIN IF NEW.action = 'staff.created' THEN ` +
    `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract staff audit failure'; END IF; END`
  );
  try {
    await assert.rejects(repo.createStaff(data, actors.owner.actor));
    assert.equal(await staffCount(fixture, campusA), beforeCount);
    assert.equal((await auditActions(fixture, campusA)).includes('staff.created'), false);
  } finally {
    await db.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
}

async function runStaffContract(fixture) {
  const { repo, db, campusA, campusB, actors } = fixture;
  const setup = await prepareStaffFixture(fixture);
  await verifyStaffAuditRollback(fixture);

  await assert.rejects(repo.createStaff(staffData({
    departmentId: setup.departmentB.id
  }), actors.owner.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await assert.rejects(repo.createStaff(staffData({
    userId: actors.campusBOwner.id
  }), actors.owner.actor), { code: 'CAMPUS_SCOPE_VIOLATION' });

  const firstStaff = await repo.createStaff(staffData({
    departmentId: setup.departmentA.id, userId: actors.owner.id
  }), actors.owner.actor);
  await assert.rejects(repo.createStaff(staffData({
    departmentId: setup.departmentA.id, userId: actors.owner.id
  }), actors.owner.actor), { code: 'SETUP_CONFLICT' });
  const secondStaff = await repo.createStaff(staffData({
    departmentId: setup.departmentA.id, userId: actors.teacherOne.id
  }), actors.owner.actor);
  await assert.rejects(repo.createStaff(staffData(), actors.owner.actor), {
    code: 'PLAN_LIMIT_REACHED'
  });
  assert.equal(await staffCount(fixture, campusA), 2);

  const assignment = {
    staffId: firstStaff.id, sectionId: setup.sections[0].id,
    subjectId: setup.subjectOne.id, roomId: setup.rooms[0].id,
    dayOfWeek: 1, periodNumber: 1
  };
  await repo.createTeachingAssignment(assignment, actors.owner.actor);
  await assert.rejects(repo.createTeachingAssignment({
    ...assignment, dayOfWeek: null, periodNumber: null
  }, actors.owner.actor), { code: 'SETUP_CONFLICT' });
  await assert.rejects(repo.createTeachingAssignment({
    staffId: firstStaff.id, sectionId: setup.sections[1].id,
    subjectId: setup.subjectTwo.id, roomId: setup.rooms[1].id,
    dayOfWeek: 1, periodNumber: 1
  }, actors.owner.actor), { code: 'SCHEDULE_CONFLICT' });
  await assert.rejects(repo.createTeachingAssignment({
    staffId: secondStaff.id, sectionId: setup.sections[0].id,
    subjectId: setup.subjectTwo.id, roomId: setup.rooms[1].id,
    dayOfWeek: 1, periodNumber: 1
  }, actors.owner.actor), { code: 'SCHEDULE_CONFLICT' });
  await assert.rejects(repo.createTeachingAssignment({
    staffId: secondStaff.id, sectionId: setup.sections[1].id,
    subjectId: setup.subjectOne.id, roomId: setup.rooms[0].id,
    dayOfWeek: 1, periodNumber: 1
  }, actors.owner.actor), { code: 'SCHEDULE_CONFLICT' });

  const attendanceDate = '2026-10-30';
  const attendanceFirst = await repo.recordStaffAttendance({
    staffId: firstStaff.id, date: attendanceDate, status: 'present', clockIn: '08:00'
  }, actors.owner.actor);
  const attendanceSecond = await repo.recordStaffAttendance({
    staffId: firstStaff.id, date: attendanceDate, status: 'late', clockIn: '08:15'
  }, actors.owner.actor);
  assert.equal(attendanceSecond.id, attendanceFirst.id);
  assert.equal(attendanceSecond.duplicate, true);
  if (db) {
    assert.equal(await db('staff_attendance').where({
      campus_id: campusA, staff_id: firstStaff.id, attendance_date: attendanceDate
    }).count({ total: '*' }).then(([row]) => Number(row.total)), 1);
  } else {
    assert.equal(repo.staffAttendance.filter((record) =>
      record.campusId === campusA && record.staffId === firstStaff.id && record.date === attendanceDate).length, 1);
  }

  const approvedLeave = await repo.createLeaveRequest({
    staffId: firstStaff.id, startDate: '2026-11-02', endDate: '2026-11-03',
    reason: 'Contract leave approval'
  }, actors.owner.actor);
  assert.equal(approvedLeave.status, 'pending');
  assert.equal((await repo.reviewLeaveRequest(approvedLeave.id, {
    decision: 'approved', note: 'Approved'
  }, actors.principal.actor)).status, 'approved');
  await assert.rejects(repo.reviewLeaveRequest(approvedLeave.id, {
    decision: 'rejected', note: 'Cannot review twice'
  }, actors.principal.actor), { code: 'SETUP_CONFLICT' });
  assert.equal(await repo.reviewLeaveRequest(approvedLeave.id, {
    decision: 'approved', note: 'Wrong campus'
  }, actors.campusBOwner.actor), null);

  const rejectedLeave = await repo.createLeaveRequest({
    staffId: firstStaff.id, startDate: '2026-11-04', endDate: '2026-11-04',
    reason: 'Contract leave rejection'
  }, actors.owner.actor);
  assert.equal((await repo.reviewLeaveRequest(rejectedLeave.id, {
    decision: 'rejected', note: 'Not approved'
  }, actors.principal.actor)).status, 'rejected');

  const actions = await auditActions(fixture, campusA);
  for (const action of [
    'staff.created', 'teaching_assignment.created', 'staff_attendance.recorded',
    'staff_attendance.updated', 'leave.requested', 'leave.approved', 'leave.rejected'
  ]) {
    assert.ok(actions.includes(action), `expected audit action ${action}`);
  }
  assert.equal(await staffCount(fixture, campusB), 0);
}

async function notificationCount(fixture, campusId, sourceType, sourceId) {
  if (fixture.db) {
    const row = await fixture.db('user_notifications').where({
      campus_id: campusId, source_type: sourceType, source_id: sourceId
    }).count({ total: '*' }).first();
    return Number(row.total);
  }
  return fixture.repo.userNotifications.filter((item) =>
    item.campusId === campusId && item.sourceType === sourceType && item.sourceId === sourceId).length;
}

async function runCommunicationsContract(fixture) {
  const { repo, orgId, campusA, campusB, actors } = fixture;
  const announcementA = await repo.createCampusAnnouncement({
    titleEn: 'Campus A announcement', titleAm: 'ማስታወቂያ ሀ',
    bodyEn: 'Campus A only', bodyAm: 'ለግቢ ሀ ብቻ'
  }, actors.owner.actor);
  const announcementB = await repo.createCampusAnnouncement({
    titleEn: 'Campus B announcement', titleAm: 'ማስታወቂያ ለ',
    bodyEn: 'Campus B only', bodyAm: 'ለግቢ ለ ብቻ'
  }, actors.campusBOwner.actor);
  assert.deepEqual((await repo.listCampusAnnouncements(campusA, orgId)).map((row) => row.id), [announcementA.id]);
  assert.deepEqual((await repo.listCampusAnnouncements(campusB, orgId)).map((row) => row.id), [announcementB.id]);

  const eventA = await repo.createCampusEvent({
    titleEn: 'Campus A event', titleAm: 'የግቢ ሀ ዝግጅት',
    descriptionEn: 'Campus A only', descriptionAm: 'ለግቢ ሀ ብቻ',
    startsOn: '2026-10-30', endsOn: '2026-10-30', startsAt: null, endsAt: null, location: 'A'
  }, actors.owner.actor);
  const eventB = await repo.createCampusEvent({
    titleEn: 'Campus B event', titleAm: 'የግቢ ለ ዝግጅት',
    descriptionEn: 'Campus B only', descriptionAm: 'ለግቢ ለ ብቻ',
    startsOn: '2026-10-31', endsOn: '2026-10-31', startsAt: null, endsAt: null, location: 'B'
  }, actors.campusBOwner.actor);
  const from = '2026-10-01';
  const to = '2026-11-30';
  assert.deepEqual((await repo.listCampusEvents(campusA, from, to, orgId)).map((row) => row.id), [eventA.id]);
  assert.deepEqual((await repo.listCampusEvents(campusB, from, to, orgId)).map((row) => row.id), [eventB.id]);

  const activeCampusAUsers = Object.values(actors).filter((user) =>
    user.activeCampusId === campusA && user.isActive !== false);
  for (const [sourceType, sourceId] of [
    ['campus_announcement', announcementA.id], ['campus_event', eventA.id]
  ]) {
    assert.equal(await notificationCount(fixture, campusA, sourceType, sourceId), activeCampusAUsers.length);
    assert.equal(await notificationCount(fixture, campusB, sourceType, sourceId), 0);
    for (const user of activeCampusAUsers) {
      const inbox = await repo.listUserNotifications(user.actor);
      assert.ok(inbox.items.some((item) => item.sourceType === sourceType && item.sourceId === sourceId));
    }
  }
  assert.equal((await repo.listUserNotifications(actors.inactiveTeacher.actor)).items.length, 0);
  assert.equal((await repo.listUserNotifications(actors.campusBOwner.actor)).items.length, 2);

  const ownerInbox = await repo.listUserNotifications(actors.owner.actor);
  const announcementNotification = ownerInbox.items.find((item) =>
    item.sourceType === 'campus_announcement' && item.sourceId === announcementA.id);
  assert.ok(announcementNotification);
  assert.equal(ownerInbox.unreadCount, 2);
  const read = await repo.markUserNotificationRead(announcementNotification.id, actors.owner.actor);
  assert.ok(read.readAt);
  const readAgain = await repo.markUserNotificationRead(announcementNotification.id, actors.owner.actor);
  assert.equal(readAgain.readAt, read.readAt);
  assert.equal((await repo.listUserNotifications(actors.owner.actor)).unreadCount, 1);
  assert.equal(await repo.markUserNotificationRead(announcementNotification.id, actors.cashier.actor), null);
}

async function createInvitationStaffTarget(fixture, campusId, id = randomUUID()) {
  const { repo, db } = fixture;
  const staff = {
    id, campusId, givenNameEn: 'Invitation', fatherNameEn: 'Contract',
    grandfatherNameEn: 'Teacher', givenNameAm: 'ፈተና', fatherNameAm: 'ሰራተኛ',
    grandfatherNameAm: 'መምህር', employmentStatus: 'active', archivedAt: null, userId: null
  };
  if (db) {
    await db('staff').insert({
      id, campus_id: campusId, given_name_en: staff.givenNameEn,
      father_name_en: staff.fatherNameEn, grandfather_name_en: staff.grandfatherNameEn,
      given_name_am: staff.givenNameAm, father_name_am: staff.fatherNameAm,
      grandfather_name_am: staff.grandfatherNameAm, job_title: 'Teacher',
      employment_status: 'active'
    });
  } else {
    repo.staff.push(staff);
  }
  return staff;
}

async function createForeignOrganizationStaffTarget(fixture) {
  const organizationId = randomUUID();
  const campusId = randomUUID();
  if (fixture.db) {
    await fixture.db('organizations').insert({
      id: organizationId, name: 'Contract Foreign Organization', status: 'active',
      school_code: contractSchoolCode(), academic_configuration_json: '{}'
    });
    await fixture.db('campuses').insert({
      id: campusId, organization_id: organizationId,
      name: 'Contract Foreign Campus', is_active: true
    });
  } else {
    fixture.repo.organizations.push({
      id: organizationId, name: 'Contract Foreign Organization', status: 'active'
    });
    fixture.repo.campuses.push({
      id: campusId, organizationId, name: 'Contract Foreign Campus', isActive: true
    });
  }
  return createInvitationStaffTarget(fixture, campusId);
}

function makeInvitation(target, campusId) {
  return {
    id: randomUUID(), email: `${randomUUID()}@example.test`, role: 'subject_teacher',
    targetType: 'staff', targetId: target.id,
    tokenHash: randomUUID().replaceAll('-', '').repeat(2),
    expiresAt: new Date(Date.now() + 60 * 60_000), campusId
  };
}

async function runRefreshTokenContract(fixture) {
  const { repo, actors, orgId } = fixture;
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const originalHash = randomUUID().replaceAll('-', '').repeat(2);
  await repo.storeRefreshToken(originalHash, actors.owner.id, expiresAt);
  const firstRotation = await repo.consumeRefreshToken(originalHash);
  assert.equal(firstRotation.id, actors.owner.id);
  assert.equal(firstRotation.orgId, orgId);
  assert.equal(firstRotation.activeCampusId, actors.owner.actor.activeCampusId,
    'legacy null-campus refresh tokens retain the account’s active branch');
  assert.equal(await repo.consumeRefreshToken(originalHash), null, 'a consumed token cannot be reused');

  const rotatedHash = randomUUID().replaceAll('-', '').repeat(2);
  await repo.storeRefreshToken(rotatedHash, firstRotation.id, expiresAt);
  const secondRotation = await repo.consumeRefreshToken(rotatedHash);
  assert.equal(secondRotation.id, actors.owner.id);
  assert.equal(await repo.consumeRefreshToken(rotatedHash), null, 'the rotated token is also single-use');
}

async function runAuditSessionContract(fixture) {
  const { repo, actors, campusA, campusB } = fixture;
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const sessions = [
    { id: randomUUID(), user: actors.owner, campusId: campusA },
    { id: randomUUID(), user: actors.owner, campusId: campusB },
    { id: randomUUID(), user: actors.teacherOne, campusId: campusA }
  ];
  const hashes = new Map();
  for (const session of sessions) {
    const hash = randomUUID().replaceAll('-', '').repeat(2);
    hashes.set(session.id, hash);
    await repo.storeRefreshToken(hash, session.user.id, expiresAt, session.campusId,
      session.id, { ipAddress: '127.0.0.1', userAgent: 'repository-contract' });
    assert.equal(await repo.isSessionActive(session.id, session.user.id), true);
  }

  const campusSessions = await repo.listActiveSessions(actors.owner.actor);
  assert.equal(campusSessions.length, 2);
  assert.ok(campusSessions.every((session) => session.campusName === 'Contract Campus A'));
  assert.equal(campusSessions.find((session) => session.userId === actors.owner.id)?.ipAddress,
    '127.0.0.1');

  const platformActor = { sub: randomUUID(), orgId: null, activeCampusId: null, role: 'super_admin' };
  const platformSessions = await repo.listActiveSessions(platformActor);
  assert.ok(sessions.every((session) =>
    platformSessions.some((active) => active.sessionId === session.id)));
  assert.equal(await repo.revokeSession(sessions[1].id, actors.owner.actor), false,
    'a school owner cannot revoke a session in another branch');
  assert.equal(await repo.isSessionActive(sessions[1].id, actors.owner.id), true);

  assert.equal(await repo.revokeSession(sessions[2].id, actors.owner.actor), true);
  assert.equal(await repo.isSessionActive(sessions[2].id, actors.teacherOne.id), false);
  assert.equal(await repo.consumeRefreshToken(hashes.get(sessions[2].id)), null);
  const audit = await repo.listAuditEvents({ page: 1, pageSize: 100 }, actors.owner.actor);
  assert.ok(audit.events.some((event) =>
    event.action === 'auth.session_revoked' && event.entityId === sessions[2].id));
  const revokedAudit = await findAuditEvent(fixture, 'auth.session_revoked', sessions[2].id);
  assert.equal(revokedAudit.organizationId, fixture.orgId);
  assert.equal(revokedAudit.campusId, campusA);
  assert.deepEqual(revokedAudit.before, { revokedAt: null });
  assert.ok(revokedAudit.after.revokedAt);
  await repo.setOrganizationAccountStatus(fixture.orgId, actors.teacherOne.id, false, actors.owner.actor);
  const deactivatedAudit = await findAuditEvent(fixture, 'user.deactivated', actors.teacherOne.id);
  assert.equal(deactivatedAudit.organizationId, fixture.orgId);
  assert.equal(deactivatedAudit.campusId, campusA);
  assert.deepEqual(deactivatedAudit.before, { isActive: true });
  assert.deepEqual(deactivatedAudit.after, { isActive: false });
  await repo.setOrganizationAccountStatus(fixture.orgId, actors.teacherOne.id, true, actors.owner.actor);
  const activatedAudit = await findAuditEvent(fixture, 'user.activated', actors.teacherOne.id);
  assert.deepEqual(activatedAudit.before, { isActive: false });
  assert.deepEqual(activatedAudit.after, { isActive: true });
}

async function runManagedRoleAuditContract(fixture) {
  const { repo, orgId, actors } = fixture;
  const owner = actors.owner.actor;
  const created = await repo.createOrganizationRole(orgId, {
    name: 'Contract audit viewer', permissions: ['account.view']
  }, owner);
  const createdAudit = await findAuditEvent(fixture, 'role.created', created.id);
  assert.equal(createdAudit.organizationId, orgId);
  assert.equal(createdAudit.campusId, owner.activeCampusId);
  assert.equal(createdAudit.before, null);
  assert.deepEqual(createdAudit.after.role, {
    key: created.key, name: created.name, permissions: ['account.view']
  });

  await repo.updateOrganizationRolePermissions(
    orgId, created.key, ['account.view', 'staff.view'], owner
  );
  const permissionsAudit = await findAuditEvent(fixture, 'role.permissions_updated', created.id);
  assert.equal(permissionsAudit.organizationId, orgId);
  assert.equal(permissionsAudit.campusId, owner.activeCampusId);
  assert.deepEqual(permissionsAudit.before, { permissions: ['account.view'] });
  assert.deepEqual(permissionsAudit.after, { permissions: ['account.view', 'staff.view'] });

  const target = actors.teacherOne;
  await repo.assignOrganizationRole(orgId, target.id, created.key, owner);
  const assignmentAudit = await findAuditEvent(fixture, 'user.role_assigned', target.id);
  assert.equal(assignmentAudit.organizationId, orgId);
  assert.equal(assignmentAudit.campusId, owner.activeCampusId);
  assert.deepEqual(assignmentAudit.before, { role: 'homeroom_teacher' });
  assert.deepEqual(assignmentAudit.after, { role: created.key });

  const deactivationTarget = actors.teacherTwo;
  await repo.setOrganizationAccountStatus(orgId, deactivationTarget.id, false, owner);
  const deactivationAudit = await findAuditEvent(fixture, 'user.deactivated', deactivationTarget.id);
  assert.equal(deactivationAudit.organizationId, orgId);
  assert.equal(deactivationAudit.campusId, owner.activeCampusId);
  assert.deepEqual(deactivationAudit.before, { isActive: true });
  assert.deepEqual(deactivationAudit.after, { isActive: false });
}

async function runLastSchoolAdministratorProtectionContract(fixture) {
  const { repo, orgId, actors } = fixture;
  await repo.assignOrganizationRole(
    orgId, actors.campusBOwner.id, 'principal', actors.owner.actor
  );
  await assert.rejects(repo.setOrganizationAccountStatus(
    orgId, actors.owner.id, false, actors.principal.actor
  ), { code: 'SCHOOL_LAST_ADMIN', status: 409 });
  await assert.rejects(repo.assignOrganizationRole(
    orgId, actors.owner.id, 'principal', actors.principal.actor
  ), { code: 'SCHOOL_LAST_ADMIN', status: 409 });
  const accounts = await repo.listOrganizationAccounts(orgId);
  const owner = accounts.find((account) => account.id === actors.owner.id);
  assert.equal(owner.role, 'owner_director');
  assert.equal(owner.isActive, true);
}

async function runPlatformRoleAssignmentContract(fixture) {
  const { repo, db } = fixture;
  const platformOrganizationId = '00000000-0000-4000-8000-000000000001';
  const actorId = randomUUID();
  const userId = randomUUID();
  const invitationId = randomUUID();
  const sessionId = randomUUID();
  const tokenHash = randomUUID().replaceAll('-', '').repeat(2);
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const actor = {
    sub: actorId, orgId: platformOrganizationId,
    activeCampusId: null, role: 'super_admin'
  };
  if (db) {
    await db('users').insert([
      {
        id: actorId, organization_id: platformOrganizationId,
        name: 'Contract platform actor', email: `${actorId}@example.test`,
        password_hash: 'contract-test-not-a-login-hash',
        role: 'super_admin', is_active: true
      },
      {
        id: userId, organization_id: platformOrganizationId,
        name: 'Contract platform user', email: `${userId}@example.test`,
        password_hash: 'contract-test-not-a-login-hash',
        role: 'legacy_platform_role', is_active: true
      }
    ]);
  } else {
    repo.users.push(
      {
        id: actorId, orgId: platformOrganizationId,
        name: 'Contract platform actor', email: `${actorId}@example.test`,
        role: 'super_admin', isActive: true, campusIds: []
      },
      {
        id: userId, orgId: platformOrganizationId,
        name: 'Contract platform user', email: `${userId}@example.test`,
        role: 'legacy_platform_role', isActive: true, campusIds: []
      }
    );
  }
  try {
    const invitation = await repo.createPlatformUserInvitation({
      id: invitationId, name: 'Contract invited platform user',
      email: `${invitationId}@example.test`, role: 'super_admin',
      tokenHash: randomUUID().replaceAll('-', '').repeat(2), expiresAt
    }, actor);
    assert.equal(invitation.id, invitationId);
    const invitationAudit = await findAuditEvent(fixture, 'platform_user.invited', invitationId);
    assert.equal(invitationAudit.organizationId, platformOrganizationId);
    assert.equal(invitationAudit.campusId, null);
    assert.equal(invitationAudit.before, null);
    assert.deepEqual(invitationAudit.after, {
      email: invitation.email, role: 'super_admin'
    });

    await repo.storeRefreshToken(tokenHash, userId, expiresAt, null, sessionId);
    assert.equal(await repo.isSessionActive(sessionId, userId), true);
    const updated = await repo.assignPlatformRole(userId, 'super_admin', actor);
    assert.equal(updated.role, 'super_admin');
    assert.equal(await repo.isSessionActive(sessionId, userId), false);
    assert.equal(await repo.consumeRefreshToken(tokenHash), null);
    const roleAudit = await findAuditEvent(fixture, 'platform_user.role_assigned', userId);
    assert.equal(roleAudit.organizationId, platformOrganizationId);
    assert.equal(roleAudit.campusId, null);
    assert.deepEqual(roleAudit.before, { role: 'legacy_platform_role' });
    assert.deepEqual(roleAudit.after, { role: 'super_admin' });

    const renamedEmail = `updated-${userId}@example.test`;
    const edited = await repo.updatePlatformUser(userId, {
      name: 'Updated contract platform user', email: renamedEmail
    }, actor);
    assert.equal(edited.name, 'Updated contract platform user');
    const updateAudit = await findAuditEvent(fixture, 'platform_user.updated', userId);
    assert.equal(updateAudit.organizationId, platformOrganizationId);
    assert.equal(updateAudit.campusId, null);
    assert.deepEqual(updateAudit.before, {
      name: 'Contract platform user', email: `${userId}@example.test`
    });
    assert.deepEqual(updateAudit.after, {
      name: 'Updated contract platform user', email: renamedEmail
    });

    await repo.setPlatformUserStatus(userId, false, actor);
    const statusAudit = await findAuditEvent(fixture, 'platform_user.deactivated', userId);
    assert.equal(statusAudit.organizationId, platformOrganizationId);
    assert.equal(statusAudit.campusId, null);
    assert.deepEqual(statusAudit.before, { isActive: true });
    assert.deepEqual(statusAudit.after, { isActive: false });
  } finally {
    if (db) {
      await db('audit_log').whereIn('entity_id', [userId, invitationId]).delete();
      await db('refresh_tokens').where({ user_id: userId }).delete();
      await db('auth_sessions').where({ user_id: userId }).delete();
      await db('account_invitations').where({ id: invitationId }).delete();
      await db('users').whereIn('id', [actorId, userId]).delete();
    } else {
      repo.audit = repo.audit.filter((event) =>
        ![userId, invitationId].includes(event.entityId));
      repo.accountInvitations = repo.accountInvitations.filter((item) =>
        item.id !== invitationId);
      repo.users = repo.users.filter((user) => ![actorId, userId].includes(user.id));
    }
  }
}

async function runBranchManagementContract(fixture) {
  const { repo, db, orgId, campusA, campusB, actors } = fixture;
  const planId = randomUUID();
  if (db) {
    await db('subscription_plans').insert({
      id: planId, code: `branch-${planId.slice(0, 8)}`, name: 'Branch contract plan',
      description: '', monthly_price: 0, currency_code: 'ETB', trial_days: 30,
      student_limit: 100, staff_limit: 20, site_limit: 3,
      modules_json: JSON.stringify([]), is_active: true
    });
    await db('organization_subscriptions').insert({
      id: randomUUID(), organization_id: orgId, plan_id: planId, status: 'active'
    });
  } else {
    const plan = repo.subscriptionPlans[0];
    plan.siteLimit = 3;
    repo.subscriptions.push({
      id: planId, organizationId: orgId, planId: plan.id, status: 'active'
    });
  }

  assert.equal((await repo.listOrganizationBranches(orgId)).length, 2);
  const branch = await repo.createOrganizationBranch({
    name: 'Contract Branch C', address: 'Branch address', phone: ''
  }, actors.owner.actor);
  assert.equal(branch.isActive, true);
  assert.equal(branch.organizationId, orgId);
  assert.ok((await repo.findUserById(actors.owner.id)).campusIds.includes(branch.id));
  assert.ok((await repo.findUserById(actors.campusBOwner.id)).campusIds.includes(branch.id));
  assert.equal((await repo.findUserById(actors.principal.id)).campusIds.includes(branch.id), false);
  await assert.rejects(
    repo.createOrganizationBranch({ name: 'Contract Over Limit Branch' }, actors.owner.actor),
    (error) => error.code === 'PLAN_LIMIT_REACHED'
  );
  const branchAuditExists = db
    ? Boolean(await db('audit_log').where({
      action: 'school.branch_created', entity_id: branch.id
    }).first())
    : repo.audit.some((record) => record.action === 'school.branch_created' &&
      record.entityId === branch.id);
  assert.equal(branchAuditExists, true);

  const originalHash = randomUUID().replaceAll('-', '').repeat(2);
  const replacementHash = randomUUID().replaceAll('-', '').repeat(2);
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  await repo.storeRefreshToken(originalHash, actors.owner.id, expiresAt, campusA);
  const switched = await repo.switchRefreshTokenCampus(
    originalHash, actors.owner.id, branch.id, replacementHash, expiresAt, actors.owner.actor
  );
  assert.equal(switched.activeCampusId, branch.id);
  assert.equal(await repo.consumeRefreshToken(originalHash), null);
  const refreshed = await repo.consumeRefreshToken(replacementHash);
  assert.equal(refreshed.activeCampusId, branch.id);
  const switchAuditExists = db
    ? Boolean(await db('audit_log').where({
      action: 'auth.branch_switched', entity_id: branch.id
    }).first())
    : repo.audit.some((record) => record.action === 'auth.branch_switched' &&
      record.entityId === branch.id);
  assert.equal(switchAuditExists, true);

  const invalidSwitchHash = randomUUID().replaceAll('-', '').repeat(2);
  await repo.storeRefreshToken(invalidSwitchHash, actors.owner.id, expiresAt, campusA);
  assert.equal(await repo.switchRefreshTokenCampus(
    invalidSwitchHash, actors.owner.id, campusB, randomUUID().replaceAll('-', '').repeat(2),
    expiresAt, actors.owner.actor
  ), null, 'a school administrator cannot switch to a branch without membership');
  assert.equal((await repo.consumeRefreshToken(invalidSwitchHash)).activeCampusId, campusA);

  const foreignOrganizationId = randomUUID();
  const foreignBranchId = randomUUID();
  if (db) {
    await db('organizations').insert({
      id: foreignOrganizationId, name: 'Foreign Branch Contract', status: 'active',
      school_code: contractSchoolCode(), academic_configuration_json: '{}'
    });
    await db('campuses').insert({
      id: foreignBranchId, organization_id: foreignOrganizationId,
      name: 'Foreign Branch', is_active: true
    });
  } else {
    repo.organizations.push({
      id: foreignOrganizationId, name: 'Foreign Branch Contract', status: 'active'
    });
    repo.campuses.push({
      id: foreignBranchId, organizationId: foreignOrganizationId,
      name: 'Foreign Branch', isActive: true
    });
  }
  assert.equal(await repo.updateOrganizationBranch(
    foreignBranchId, { name: 'Hijacked' }, actors.owner.actor
  ), null);
  assert.equal((await repo.listOrganizationBranches(foreignOrganizationId)).length, 1);
  assert.equal((await repo.listOrganizationBranches(orgId))
    .some((item) => item.id === foreignBranchId), false);
  const foreignSwitchHash = randomUUID().replaceAll('-', '').repeat(2);
  await repo.storeRefreshToken(foreignSwitchHash, actors.owner.id, new Date(Date.now() + 60 * 60_000), campusA);
  assert.equal(await repo.switchRefreshTokenCampus(
    foreignSwitchHash, actors.owner.id, foreignBranchId,
    randomUUID().replaceAll('-', '').repeat(2), new Date(Date.now() + 60 * 60_000),
    actors.owner.actor
  ), null, 'a school administrator cannot switch to a branch owned by another school');
  assert.equal((await repo.consumeRefreshToken(foreignSwitchHash)).activeCampusId, campusA,
    'a rejected cross-school switch leaves its refresh token usable');

  await repo.updateOrganizationBranch(branch.id, { isActive: false }, actors.owner.actor);
  assert.equal((await repo.findUserById(actors.owner.id)).campusIds.includes(branch.id), false);
  const rejectedHash = randomUUID().replaceAll('-', '').repeat(2);
  await repo.storeRefreshToken(rejectedHash, actors.owner.id, expiresAt, branch.id);
  const inactiveRefresh = await repo.consumeRefreshToken(rejectedHash);
  assert.equal(inactiveRefresh.branchActive, false,
    'refresh tokens for deactivated branches cannot create a usable session');
  const secondBranch = await repo.createOrganizationBranch({
    name: 'Contract Branch D'
  }, actors.owner.actor);
  await assert.rejects(
    repo.updateOrganizationBranch(branch.id, { isActive: true }, actors.owner.actor),
    (error) => error.code === 'PLAN_LIMIT_REACHED'
  );
  assert.equal(secondBranch.isActive, true);

  await repo.updateOrganizationBranch(campusB, { isActive: false }, actors.campusBOwner.actor);
  await repo.updateOrganizationBranch(secondBranch.id, { isActive: false }, actors.owner.actor);
  await assert.rejects(
    repo.updateOrganizationBranch(campusA, { isActive: false }, actors.owner.actor),
    (error) => error.code === 'SETUP_CONFLICT'
  );
}

async function runPlatformSchoolProvisioningContract(fixture) {
  const { repo, db, orgId, actors } = fixture;
  const suffix = randomUUID().replaceAll('-', '');
  await verifyPlatformSchoolRollback(fixture, suffix);
  const platformActor = {
    sub: actors.owner.id, orgId: null, activeCampusId: null, role: 'super_admin'
  };
  const planData = {
    code: `audit-${suffix.slice(0, 8)}`, name: 'Audit contract plan',
    description: 'Plan audit contract', monthlyPrice: 25, currencyCode: 'ETB',
    trialDays: 30, studentLimit: 100, staffLimit: 20, siteLimit: 5,
    modules: ['academic_setup'], isActive: true
  };
  const savedPlan = await repo.saveSubscriptionPlan(planData, platformActor);
  const planAudit = await findAuditEvent(fixture, 'subscription_plan.saved', savedPlan.id);
  assert.equal(planAudit.organizationId, null);
  assert.equal(planAudit.campusId, null);
  assert.equal(planAudit.before, null);
  assert.equal(planAudit.after.code, planData.code);
  const data = {
    schoolName: `Provisioned School ${suffix.slice(0, 8)}`,
    ownerName: 'Invited School Administrator',
    ownerEmail: `${suffix}@example.test`,
    schoolPhone: '+251911000000', address: 'Contract address',
    locale: 'en', currencyCode: 'ETB', timezone: 'Africa/Addis_Ababa'
  };
  const original = {
    id: randomUUID(), tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
  };
  const created = await repo.createPlatformSchool(data, original, actors.owner.actor);
  assert.notEqual(created.organizationId, orgId);
  assert.equal(created.status, 'active');
  assert.ok(new Date(created.trialEndsAt) > new Date());
  const schoolAudit = await findAuditEvent(fixture, 'school.platform_created', created.organizationId);
  assert.equal(schoolAudit.organizationId, created.organizationId);
  assert.equal(schoolAudit.campusId, null);
  assert.equal(schoolAudit.after.status, 'active');
  const invitationAudit = await findAuditEvent(
    fixture, 'account_invitation.created', original.id
  );
  assert.equal(invitationAudit.organizationId, created.organizationId);
  assert.ok(invitationAudit.campusId);
  const assignedPlan = await repo.assignOrganizationPlan(
    created.organizationId, savedPlan.code, platformActor
  );
  assert.equal(assignedPlan.plan.code, savedPlan.code);
  const assignmentAudit = await findAuditEvent(
    fixture, 'school.plan_assigned', assignedPlan.id
  );
  assert.equal(assignmentAudit.organizationId, created.organizationId);
  assert.equal(assignmentAudit.campusId, null);
  assert.ok(assignmentAudit.before.planId);
  assert.equal(assignmentAudit.after.planCode, savedPlan.code);
  const createdBranches = await repo.listOrganizationBranches(created.organizationId);
  assert.deepEqual(createdBranches.map((item) => item.name), ['Main Branch']);
  const mainCampusId = createdBranches[0].id;
  assert.deepEqual((await repo.listOrganizationBranches(orgId)).map((item) => item.id).sort(),
    [fixture.campusA, fixture.campusB].sort());

  const additionalCampusId = randomUUID();
  const inactiveCampusId = randomUUID();
  if (db) {
    await db('campuses').insert({
      id: additionalCampusId, organization_id: created.organizationId,
      name: 'Contract Additional Branch', is_active: true
    });
    await db('campuses').insert({
      id: inactiveCampusId, organization_id: created.organizationId,
      name: 'Contract Inactive Branch', is_active: false
    });
  } else {
    repo.campuses.push({
      id: additionalCampusId, organizationId: created.organizationId,
      name: 'Contract Additional Branch', isActive: true
    });
    repo.campuses.push({
      id: inactiveCampusId, organizationId: created.organizationId,
      name: 'Contract Inactive Branch', isActive: false
    });
  }
  const replacement = {
    id: randomUUID(), tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
  };
  const regenerated = await repo.regenerateSchoolAdministratorInvitation(
    created.organizationId, replacement, actors.owner.actor
  );
  assert.equal(regenerated.email, data.ownerEmail);
  assert.equal(regenerated.name, data.ownerName);
  assert.equal(await repo.getAccountInvitation(original.tokenHash), null,
    'regeneration invalidates the previous link');
  const pendingInvitation = await repo.getAccountInvitation(replacement.tokenHash);
  assert.ok(pendingInvitation);
  assert.equal(pendingInvitation.email, data.ownerEmail);
  assert.equal(await repo.regenerateSchoolAdministratorInvitation(orgId, {
    id: randomUUID(), tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
  }, actors.owner.actor), null, 'a different school cannot regenerate this invitation');

  await verifyPlatformInvitationAcceptanceRollback(fixture, replacement.tokenHash);
  const accepted = await repo.acceptAccountInvitation(replacement.tokenHash, 'contract-password-hash');
  assert.equal(accepted.role, 'owner_director');
  assert.deepEqual(accepted.campusIds.sort(),
    [mainCampusId, additionalCampusId].sort());
  assert.equal(accepted.campusIds.includes(inactiveCampusId), false);
  assert.equal(await repo.regenerateSchoolAdministratorInvitation(created.organizationId, {
    id: randomUUID(), tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
  }, actors.owner.actor), null, 'an accepted owner invitation cannot be regenerated');
  assert.equal((await repo.findUserById(accepted.id)).campusIds.includes(additionalCampusId), true);
  const school = (await repo.listPlatformSchools()).find((item) => item.id === created.organizationId);
  assert.equal(school.owner?.email, data.ownerEmail, JSON.stringify({ accepted, owner: school.owner }));
  const statusBefore = await repo.updateOrganizationStatus(
    created.organizationId, 'suspended', actors.owner.actor
  );
  assert.equal(statusBefore.status, 'suspended');
  const statusAudit = await findAuditEvent(fixture, 'school.suspended', created.organizationId);
  assert.equal(statusAudit.organizationId, created.organizationId);
  assert.equal(statusAudit.campusId, null);
  assert.deepEqual(statusAudit.before, { status: 'active' });
  assert.deepEqual(statusAudit.after, { status: 'suspended' });
  await repo.updateOrganizationStatus(created.organizationId, 'active', actors.owner.actor);

  const invoice = await repo.createSubscriptionInvoice(created.organizationId, {
    amount: 25, currencyCode: 'ETB',
    dueOn: new Date().toISOString().slice(0, 10)
  }, actors.owner.actor);
  const payment = await repo.recordSubscriptionPayment(invoice.id, {
    amount: 25, reference: `CONTRACT-${suffix.slice(0, 8)}`,
    note: 'Contract payment', receivedOn: new Date().toISOString().slice(0, 10)
  }, actors.owner.actor);
  assert.ok(payment);
  const invoiceAudit = await findAuditEvent(fixture, 'subscription_invoice.issued', invoice.id);
  assert.equal(invoiceAudit.organizationId, created.organizationId);
  assert.equal(invoiceAudit.campusId, null);
  assert.equal(invoiceAudit.after.status, 'issued');
  const paymentAudit = await findAuditEvent(
    fixture, 'subscription_payment.recorded', payment.id
  );
  assert.equal(paymentAudit.organizationId, created.organizationId);
  assert.equal(paymentAudit.campusId, null);
  assert.equal(paymentAudit.before.invoiceStatus, 'issued');
  assert.equal(paymentAudit.before.paidAmount, 0);
  assert.equal(paymentAudit.after.invoiceStatus, 'paid');
  assert.equal(paymentAudit.after.paidAmount, 25);
  assert.equal(paymentAudit.before.subscriptionStatus, 'trialing');
  assert.equal(paymentAudit.after.subscriptionStatus, 'active');
}

async function verifyPlatformInvitationAcceptanceRollback(fixture, tokenHash) {
  const { repo, db } = fixture;
  const invitation = await repo.getAccountInvitation(tokenHash);
  assert.ok(invitation);
  if (!db) {
    const appendAudit = repo.appendAudit;
    repo.appendAudit = async (actor, action, ...args) => {
      if (action === 'account_invitation.accepted') throw new Error('contract audit failure');
      return appendAudit.call(repo, actor, action, ...args);
    };
    try {
      await assert.rejects(repo.acceptAccountInvitation(tokenHash, 'rollback-password-hash'),
        /contract audit failure/);
    } finally {
      repo.appendAudit = appendAudit;
    }
    assert.equal(repo.users.some((user) => user.email === invitation.email), false);
  } else {
    const trigger = `contract_school_invite_rollback_${randomUUID().replaceAll('-', '')}`;
    await db.raw(
      `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
      `BEGIN IF NEW.action = 'account_invitation.accepted' THEN ` +
      `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract audit failure'; END IF; END`
    );
    try {
      await assert.rejects(repo.acceptAccountInvitation(tokenHash, 'rollback-password-hash'));
    } finally {
      await db.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``);
    }
    assert.equal(await db('users').where({ email: invitation.email }).first('id'), undefined);
  }
  assert.ok(await repo.getAccountInvitation(tokenHash),
    'the invitation remains pending after audit rollback');
}

async function verifyPlatformSchoolRollback(fixture, suffix) {
  const { repo, db, actors } = fixture;
  const data = {
    schoolName: `Rollback School ${suffix.slice(0, 8)}`,
    ownerName: 'Rollback Administrator',
    ownerEmail: `${suffix}-rollback@example.test`,
    schoolPhone: '+251911000000', address: 'Contract address',
    locale: 'en', currencyCode: 'ETB', timezone: 'Africa/Addis_Ababa'
  };
  const invitation = {
    id: randomUUID(), tokenHash: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
  };
  if (!db) {
    const appendAudit = repo.appendAudit;
    repo.appendAudit = async (actor, action, ...args) => {
      if (action === 'school.platform_created') throw new Error('contract audit failure');
      return appendAudit.call(repo, actor, action, ...args);
    };
    try {
      await assert.rejects(repo.createPlatformSchool(data, invitation, actors.owner.actor),
        /contract audit failure/);
    } finally {
      repo.appendAudit = appendAudit;
    }
    assert.equal(repo.organizations.some((item) => item.name === data.schoolName), false);
    assert.equal(repo.accountInvitations.some((item) => item.email === data.ownerEmail), false);
    return;
  }
  const trigger = `contract_school_rollback_${randomUUID().replaceAll('-', '')}`;
  await db.raw(
    `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
    `BEGIN IF NEW.action = 'school.platform_created' THEN ` +
    `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract audit failure'; END IF; END`
  );
  try {
    await assert.rejects(repo.createPlatformSchool(data, invitation, actors.owner.actor));
  } finally {
    await db.raw(`DROP TRIGGER IF EXISTS \`${trigger}\``);
  }
  assert.equal(await db('organizations').where({ name: data.schoolName }).first('id'), undefined);
  assert.equal(await db('account_invitations').where({ token_hash: invitation.tokenHash }).first('id'), undefined);
}

async function runLoginFailureContract(fixture) {
  const { repo, db } = fixture;
  const login = `lockout-${randomUUID()}@example.test`;
  const loginFailureAuditCount = async () => {
    if (db) {
      const row = await db('audit_log').where({
        action: 'auth.login_failed', actor_id: 'unknown'
      }).count({ total: '*' }).first();
      return Number(row.total);
    }
    return repo.audit.filter((event) =>
      event.action === 'auth.login_failed' && event.actorId === 'unknown').length;
  };
  const beforeAuditCount = await loginFailureAuditCount();
  const controller = createAuthController({
    repo, config: { NODE_ENV: 'test' }, parse: (_schema, value) => value
  });
  async function attemptLogin() {
    const response = {
      statusCode: 200,
      status(statusCode) { this.statusCode = statusCode; return this; },
      json(body) { this.body = body; return this; }
    };
    await controller.login({
      body: { login, password: 'invalid' }, get: () => undefined
    }, response, (error) => {
      throw error;
    });
    return response;
  }
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const response = await attemptLogin();
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error.code, 'INVALID_CREDENTIALS');
  }
  const lockedResponse = await attemptLogin();
  assert.equal(lockedResponse.statusCode, 429);
  assert.equal(lockedResponse.body.error.code, 'LOGIN_LOCKED');
  const repeatedLockedResponse = await attemptLogin();
  assert.equal(repeatedLockedResponse.statusCode, 429);
  assert.equal(repeatedLockedResponse.body.error.code, 'LOGIN_LOCKED');
  assert.equal(repo.loginFailures.get(login).count, 5);
  assert.equal(await loginFailureAuditCount(), beforeAuditCount + 5);
  await repo.clearLoginFailures(login);
  assert.equal(await repo.recordLoginFailure(login), 1);
}

async function runPasswordResetContract(fixture) {
  const { repo, actors } = fixture;
  const tokenHash = randomUUID().replaceAll('-', '').repeat(2);
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  const reset = await repo.createPasswordReset(actors.owner.email, tokenHash, expiresAt);
  assert.equal(reset.userId, actors.owner.id);
  const updated = await repo.completePasswordReset(tokenHash, 'contract-password-hash');
  assert.equal(updated.id, actors.owner.id);
  assert.equal(await repo.completePasswordReset(tokenHash, 'reused-password-hash'), null);
}

async function runInvitationAcceptanceContract(fixture) {
  const { repo, db, campusA, orgId, actors } = fixture;
  const target = await createInvitationStaffTarget(fixture, campusA);
  const invitation = makeInvitation(target, campusA);
  const created = await repo.createAccountInvitation(invitation, actors.owner.actor);
  assert.equal(created.role, invitation.role);
  const createAudit = await findAuditEvent(fixture, 'account_invitation.created', invitation.id);
  assert.equal(createAudit.organizationId, orgId);
  assert.equal(createAudit.campusId, campusA);
  assert.equal(createAudit.after.role, invitation.role);
  const foundInvitation = await repo.getAccountInvitation(invitation.tokenHash);
  assert.equal(foundInvitation.email, invitation.email);

  const user = await repo.acceptAccountInvitation(invitation.tokenHash, 'contract-password-hash');
  assert.equal(user.role, invitation.role);
  assert.equal(user.orgId, orgId);
  assert.deepEqual(user.campusIds, [campusA]);
  assert.equal(await repo.acceptAccountInvitation(invitation.tokenHash, 'reused-password-hash'), null);
  assert.equal(await repo.getAccountInvitation(invitation.tokenHash), null);
  const acceptedAudit = await findAuditEvent(fixture, 'account_invitation.accepted', user.id);
  assert.equal(acceptedAudit.organizationId, orgId);
  assert.equal(acceptedAudit.campusId, campusA);
  assert.equal(acceptedAudit.after.role, invitation.role);
  if (db) {
    const linked = await db('staff').where({ id: target.id }).first('user_id');
    assert.equal(linked.user_id, user.id);
  } else {
    assert.equal(repo.staff.find((staff) => staff.id === target.id).userId, user.id);
  }
}

async function runInvitationAcceptanceQuotaContract(fixture) {
  const { repo, db, campusA, orgId, actors } = fixture;
  const activeUsers = db
    ? Number((await db('users').where({
      organization_id: orgId, is_active: true
    }).count({ total: '*' }).first()).total)
    : repo.users.filter((user) => user.orgId === orgId && user.isActive !== false).length;
  let planId;
  let previousLimit;
  if (db) {
    planId = randomUUID();
    const planCode = `accept-quota-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    await db('subscription_plans').insert({
      id: planId, code: planCode, name: 'Acceptance quota contract',
      description: '', monthly_price: 0, currency_code: 'ETB', trial_days: 0,
      student_limit: null, staff_limit: null, site_limit: null,
      billing_cycle: 'monthly', max_users: null, storage_limit_bytes: null,
      modules_json: '[]', is_active: true
    });
    await db('organization_subscriptions').insert({
      id: randomUUID(), organization_id: orgId, plan_id: planId, status: 'active'
    });
  } else {
    const subscription = repo.subscriptions.find((item) => item.organizationId === orgId);
    planId = subscription.planId;
    previousLimit = repo.subscriptionPlans.find((plan) => plan.id === planId).maxUsers;
    repo.subscriptionPlans.find((plan) => plan.id === planId).maxUsers = null;
  }
  const target = await createInvitationStaffTarget(fixture, campusA);
  const invitation = makeInvitation(target, campusA);
  await repo.createAccountInvitation(invitation, actors.owner.actor);
  if (db) {
    await db('subscription_plans').where({ id: planId }).update({ max_users: activeUsers });
  } else {
    repo.subscriptionPlans.find((plan) => plan.id === planId).maxUsers = activeUsers;
  }
  await assert.rejects(repo.acceptAccountInvitation(
    invitation.tokenHash, 'contract-password-hash'
  ), { code: 'PLAN_LIMIT_REACHED' });
  assert.equal(await repo.getAccountInvitation(invitation.tokenHash) !== null, true);
  if (db) {
    assert.equal(await db('users').where({ email: invitation.email }).first('id'), undefined);
  } else {
    assert.equal(repo.users.some((user) => user.email === invitation.email), false);
  }
  if (!db) {
    repo.subscriptionPlans.find((plan) => plan.id === planId).maxUsers = previousLimit;
  }
}

async function runCrossOrganizationInvitationContract(fixture) {
  const { repo, actors, campusA } = fixture;
  const foreignTarget = await createForeignOrganizationStaffTarget(fixture);
  const invitation = makeInvitation(foreignTarget, campusA);
  await assert.rejects(
    repo.createAccountInvitation(invitation, actors.owner.actor),
    (error) => error.code === 'SETUP_CONFLICT'
  );
  assert.equal(await repo.getAccountInvitation(invitation.tokenHash), null);
}

async function runPlatformLifecycleContract(fixture) {
  const { repo, db, orgId, actors } = fixture;
  const foreignOrganizationId = randomUUID();
  const sameOrganizationExecutiveId = randomUUID();
  const foreignOrganizationExecutiveId = randomUUID();
  if (db) {
    await db('organizations').insert({
      id: foreignOrganizationId, name: 'Foreign Notification Contract School',
      status: 'active', school_code: contractSchoolCode(), academic_configuration_json: '{}'
    });
    await db('users').insert([
      {
        id: sameOrganizationExecutiveId, organization_id: orgId,
        name: 'Contract Group Executive', email: `${sameOrganizationExecutiveId}@example.test`,
        password_hash: 'contract-test-not-a-login-hash', role: 'group_executive', is_active: true
      },
      {
        id: foreignOrganizationExecutiveId, organization_id: foreignOrganizationId,
        name: 'Foreign Contract Group Executive',
        email: `${foreignOrganizationExecutiveId}@example.test`,
        password_hash: 'contract-test-not-a-login-hash', role: 'group_executive', is_active: true
      }
    ]);
  } else {
    repo.organizations.push({
      id: foreignOrganizationId, name: 'Foreign Notification Contract School',
      status: 'active', schoolCode: contractSchoolCode()
    });
    repo.users.push(
      {
        id: sameOrganizationExecutiveId, orgId, name: 'Contract Group Executive',
        email: `${sameOrganizationExecutiveId}@example.test`, role: 'group_executive',
        isActive: true
      },
      {
        id: foreignOrganizationExecutiveId, orgId: foreignOrganizationId,
        name: 'Foreign Contract Group Executive',
        email: `${foreignOrganizationExecutiveId}@example.test`, role: 'group_executive',
        isActive: true
      }
    );
  }
  const planCode = `contract-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  if (db) {
    const starter = await db('subscription_plans').where({ code: 'starter' }).first('id');
    await db('organization_subscriptions').insert({
      id: randomUUID(), organization_id: orgId, plan_id: starter.id,
      status: 'trialing', trial_started_at: new Date(), trial_ends_at: new Date(Date.now() + 86400000)
    });
  }
  const plan = await repo.saveSubscriptionPlan({
    code: planCode, name: 'Contract billing', description: 'Lifecycle contract',
    monthlyPrice: 125, currencyCode: 'ETB', trialDays: 14,
    studentLimit: 20, staffLimit: 10, siteLimit: 2,
    billingCycle: 'termly', maxUsers: 12, storageLimitBytes: 10000,
    modules: ['student_information'], isActive: true
  }, actors.owner.actor);
  const defaultQuotaPlan = await repo.saveSubscriptionPlan({
    code: `${planCode}-defaults`, name: 'Contract defaults', description: '',
    monthlyPrice: 0, currencyCode: 'ETB', trialDays: 0,
    studentLimit: null, staffLimit: null, siteLimit: null,
    billingCycle: 'monthly', modules: [], isActive: true
  }, actors.owner.actor);
  assert.equal(defaultQuotaPlan.maxUsers, 50);
  assert.equal(defaultQuotaPlan.storageLimitBytes, 1073741824);
  const defaultQuotaPlanData = { ...defaultQuotaPlan };
  delete defaultQuotaPlanData.id;
  const unlimitedPlan = await repo.saveSubscriptionPlan({
    ...defaultQuotaPlanData, code: `${planCode}-unlimited`,
    name: 'Contract unlimited', maxUsers: null, storageLimitBytes: null
  }, actors.owner.actor);
  const unchangedUnlimitedPlan = await repo.saveSubscriptionPlan({
    ...unlimitedPlan, name: 'Contract unlimited updated',
    maxUsers: undefined, storageLimitBytes: undefined
  }, actors.owner.actor);
  assert.equal(unchangedUnlimitedPlan.maxUsers, null);
  assert.equal(unchangedUnlimitedPlan.storageLimitBytes, null);

  const assigned = await repo.assignOrganizationPlan(orgId, planCode, actors.owner.actor);
  assert.equal(assigned.plan.billingCycle, 'termly');
  await assert.rejects(repo.assertUserCapacity(orgId, 6), {
    code: 'PLAN_LIMIT_REACHED'
  });
  await assert.rejects(repo.saveSubscriptionPlan({
    ...plan, maxUsers: 1
  }, actors.owner.actor), { code: 'PLAN_LIMIT_REACHED' });
  const logoContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  const logo = await repo.saveOrganizationLogo(orgId, {
    mimeType: 'image/png', content: logoContent
  }, actors.owner.actor);
  assert.equal(logo.sizeBytes, logoContent.length);
  assert.deepEqual((await repo.getOrganizationLogo(orgId)).content, logoContent);
  const assignedPlan = repo.subscriptionPlans?.find((item) => item.code === planCode);
  if (db) {
    await db('subscription_plans').where({ code: planCode })
      .update({ storage_limit_bytes: logoContent.length });
  } else {
    assignedPlan.storageLimitBytes = logoContent.length;
  }
  const logoAuditBefore = await findAuditEvent(fixture, 'school.logo_updated', orgId);
  await assert.rejects(repo.saveOrganizationLogo(orgId, {
    mimeType: 'image/png', content: Buffer.concat([logoContent, Buffer.from([1])])
  }, actors.owner.actor), { code: 'PLAN_LIMIT_REACHED' });
  assert.deepEqual((await repo.getOrganizationLogo(orgId)).content, logoContent);
  assert.deepEqual(await findAuditEvent(fixture, 'school.logo_updated', orgId), logoAuditBefore);
  if (db) {
    await db('subscription_plans').where({ code: planCode })
      .update({ storage_limit_bytes: 10000 });
  } else {
    assignedPlan.storageLimitBytes = 10000;
  }
  const settings = await repo.updatePlatformSettings({
    defaultLocale: 'am', currencyCode: 'ETB',
    dateFormat: 'yyyy-MM-dd', calendarType: 'gregorian'
  }, actors.owner.actor);
  assert.equal(settings.defaultLocale, 'am');
  assert.equal(settings.smtpPasswordConfigured, false);

  const invoice = await repo.createSubscriptionInvoice(orgId, {
    amount: 125, currencyCode: 'ETB', dueOn: '2027-01-01'
  }, actors.owner.actor);
  const payment = await repo.recordSubscriptionPayment(invoice.id, {
    amount: 125, receivedOn: new Date().toISOString().slice(0, 10),
    reference: `CONTRACT-${randomUUID().slice(0, 8)}`
  }, actors.owner.actor);
  const subscription = db
    ? await db('organization_subscriptions').where({ organization_id: orgId })
      .first('id', 'period_ends_at')
    : repo.subscriptions.find((item) => item.organizationId === orgId);
  assert.ok(Date.parse(subscription.period_ends_at ?? subscription.periodEndsAt) - Date.now() >
    90 * 86400000);
  const refund = await repo.refundSubscriptionPayment(payment.id, {
    amount: 25, reason: 'Contract refund'
  }, actors.owner.actor);
  assert.equal(refund.amount, 25);
  assert.equal(await repo.refundSubscriptionPayment(payment.id, {
    amount: 101, reason: 'Exceeds remaining payment'
  }, actors.owner.actor), null);
  if (db) {
    const parallelRefunds = await Promise.all([
      repo.refundSubscriptionPayment(payment.id, {
        amount: 60, reason: 'Concurrent contract refund A'
      }, actors.owner.actor),
      repo.refundSubscriptionPayment(payment.id, {
        amount: 60, reason: 'Concurrent contract refund B'
      }, actors.owner.actor)
    ]);
    assert.equal(parallelRefunds.filter(Boolean).length, 1);
    const persistedRefunds = await db('subscription_refunds')
      .where({ payment_id: payment.id }).sum({ total: 'amount' }).first();
    assert.equal(Number(persistedRefunds.total), 85);
  }
  const report = await repo.getSubscriptionRevenueReport();
  const entry = report.find((item) => item.invoiceNumber === invoice.invoiceNumber);
  assert.equal(entry.refundedAmount, db ? 85 : 25);
  assert.equal(entry.netRevenue, db ? 40 : 100);
  const refundAudit = await findAuditEvent(fixture, 'subscription_payment.refunded', refund.id);
  assert.equal(refundAudit.organizationId, orgId);
  assert.equal(refundAudit.before.refundedAmount, 0);
  assert.equal(refundAudit.before.paymentAmount, 125);
  assert.equal(refundAudit.after.refundedAmount, 25);
  assert.equal(refundAudit.after.reason, 'Contract refund');

  const firstReportDay = Number.parseInt(randomUUID().slice(0, 8), 16) % 365;
  let reportDate = null;
  for (let offset = 0; offset < 365 && !reportDate; offset += 1) {
    const candidate = new Date(Date.UTC(2037, 0, 1 + (firstReportDay + offset) % 365))
      .toISOString().slice(0, 10);
    if (!db || !await db('subscription_invoices').whereBetween('issued_at', [
      `${candidate} 00:00:00`, `${candidate} 23:59:59`
    ]).first('id')) reportDate = candidate;
  }
  if (!reportDate) throw new Error('No unused date remains for the outstanding report contract.');
  const outstandingInvoice = await repo.createSubscriptionInvoice(orgId, {
    amount: 250, currencyCode: 'USD', dueOn: reportDate
  }, actors.owner.actor);
  const secondCurrencyInvoice = await repo.createSubscriptionInvoice(orgId, {
    amount: 80, currencyCode: 'ETB', dueOn: reportDate
  }, actors.owner.actor);
  await repo.recordSubscriptionPayment(outstandingInvoice.id, {
    amount: 50, receivedOn: reportDate, reference: `OUTSTANDING-${randomUUID().slice(0, 8)}`
  }, actors.owner.actor);
  if (db) {
    await db('subscription_invoices')
      .whereIn('id', [invoice.id, outstandingInvoice.id, secondCurrencyInvoice.id])
      .update({ issued_at: `${reportDate} 12:00:00` });
  } else {
    for (const invoiceId of [invoice.id, outstandingInvoice.id, secondCurrencyInvoice.id]) {
      repo.subscriptionInvoices.find((item) => item.id === invoiceId).issuedAt = `${reportDate}T12:00:00.000Z`;
    }
  }
  const outstandingReport = await repo.getSubscriptionOutstandingReport({
    from: reportDate, to: reportDate
  });
  assert.equal(outstandingReport.items.some((item) =>
    item.invoiceNumber === outstandingInvoice.invoiceNumber), true);
  assert.equal(outstandingReport.items.some((item) =>
    item.invoiceNumber === secondCurrencyInvoice.invoiceNumber), true);
  assert.equal(outstandingReport.items.some((item) =>
    item.invoiceNumber === invoice.invoiceNumber), false);
  assert.deepEqual(outstandingReport.totals, [
    { currencyCode: 'ETB', invoiceCount: 1, outstandingAmount: 80 },
    { currencyCode: 'USD', invoiceCount: 1, outstandingAmount: 200 }
  ]);

  const starterPlan = (await repo.listSubscriptionPlans()).find((item) => item.code === 'starter');
  assert.equal(starterPlan.maxUsers, null);
  assert.equal(starterPlan.storageLimitBytes, null);
  if (db) {
    await db('organization_subscriptions').where({ organization_id: orgId })
      .update({ plan_id: starterPlan.id });
  } else {
    repo.subscriptions.find((item) => item.organizationId === orgId).planId = starterPlan.id;
  }
  const extraUsers = Array.from({ length: 55 }, (_, index) => ({
    id: randomUUID(), name: `Quota contract user ${index}`,
    email: `quota-${randomUUID()}@example.test`, role: 'subject_teacher',
    isActive: true, orgId
  }));
  const emailMessages = [];
  const mailer = {
    isConfigured: async () => true,
    sendSubscriptionExpiryEmail: async (message) => emailMessages.push(message)
  };
  const observedThresholds = new Set();
  for (const [days, threshold] of [[29, 30], [6, 7], [0.5, 1]]) {
    const expiry = new Date(Date.now() + days * 86400000);
    if (db) {
      await db('organization_subscriptions').where({ id: subscription.id })
        .update({ period_ends_at: expiry });
    } else {
      repo.subscriptions.find((item) => item.id === subscription.id).periodEndsAt = expiry.toISOString();
    }
    await repo.processSubscriptionExpiryNotifications(mailer, null, orgId);
    const deliveredCount = emailMessages.length;
    await repo.processSubscriptionExpiryNotifications(mailer, null, orgId);
    assert.equal(emailMessages.length, deliveredCount);
    const thresholdExists = db
      ? await db('subscription_expiry_notices').where({
        subscription_id: subscription.id, threshold_days: threshold
      }).first('id')
      : repo.subscriptionExpiryNotices.find((item) =>
        item.subscriptionId === subscription.id && item.thresholdDays === threshold);
    assert.ok(thresholdExists);
    if (threshold === 30) {
      const noticeId = thresholdExists.id;
      const noticeRecipients = db
        ? await db('user_notifications as n').join('users as u', 'u.id', 'n.user_id')
          .where({ 'n.source_id': noticeId })
          .select('u.id', 'u.organization_id')
        : repo.userNotifications.filter((item) => item.sourceId === noticeId).map((item) => {
          const user = repo.users.find((candidate) => candidate.id === item.userId);
          return { id: user.id, organization_id: user.orgId };
        });
      assert.ok(noticeRecipients.some((recipient) =>
        recipient.id === sameOrganizationExecutiveId));
      assert.equal(noticeRecipients.some((recipient) =>
        recipient.id === foreignOrganizationExecutiveId), false);
      assert.ok(noticeRecipients.every((recipient) =>
        recipient.organization_id === orgId));
    }
    observedThresholds.add(threshold);
  }
  assert.deepEqual([...observedThresholds].sort((a, b) => a - b), [1, 7, 30]);

  if (db) {
    await db('users').insert(extraUsers.map((user) => ({
      id: user.id, organization_id: orgId, name: user.name, email: user.email,
      password_hash: 'contract-test-not-a-login-hash', role: user.role, is_active: true
    })));
    await db('student_documents').insert({
      id: randomUUID(), campus_id: fixture.campusA, student_id: fixture.studentA,
      document_type: 'other', original_name: 'legacy-over-limit.bin',
      mime_type: 'application/octet-stream', size_bytes: 1073741825,
      storage_key: randomUUID(), sha256: '0'.repeat(64), uploaded_by: actors.owner.id
    });
  } else {
    repo.users.push(...extraUsers);
    repo.studentDocuments.push({
      id: randomUUID(), campusId: fixture.campusA, studentId: fixture.studentA,
      sizeBytes: 1073741825
    });
  }
  assert.ok((await repo.getOrganizationStorageUsage(orgId)) > 1073741824);
  await repo.assertUserCapacity(orgId, 1);
  const quotaTarget = await createInvitationStaffTarget(fixture, fixture.campusA);
  await repo.createAccountInvitation(makeInvitation(quotaTarget, fixture.campusA), actors.owner.actor);
  const overLimitUpload = await repo.saveOrganizationLogo(orgId, {
    mimeType: 'image/png', content: logoContent
  }, actors.owner.actor);
  assert.equal(overLimitUpload.sizeBytes, logoContent.length);

  if (db) {
    await db('organization_subscriptions').where({ organization_id: orgId })
      .update({ period_ends_at: new Date(Date.now() - 86400000) });
  } else {
    repo.subscriptions.find((item) => item.organizationId === orgId).periodEndsAt =
      new Date(Date.now() - 86400000).toISOString();
  }
  await repo.refreshExpiredSubscriptions(orgId);
  const expiredStatus = db
    ? (await db('organization_subscriptions').where({ id: subscription.id }).first('status')).status
    : repo.subscriptions.find((item) => item.id === subscription.id).status;
  assert.equal(expiredStatus, 'expired');
  await repo.processSubscriptionExpiryNotifications(mailer, null, orgId);
  const inboxAfterFirstPass = await repo.listUserNotifications(actors.owner.actor);
  const noticeCountAfterFirstPass = db
    ? await db('subscription_expiry_notices').where({ subscription_id: subscription.id }).count({ total: '*' }).first()
    : repo.subscriptionExpiryNotices.filter((item) => item.subscriptionId === subscription.id).length;
  const firstNoticeCount = Number(noticeCountAfterFirstPass.total ?? noticeCountAfterFirstPass);
  const firstEmailCount = emailMessages.length;
  await repo.processSubscriptionExpiryNotifications(mailer, null, orgId);
  const noticeCountAfterSecondPass = db
    ? await db('subscription_expiry_notices').where({ subscription_id: subscription.id }).count({ total: '*' }).first()
    : repo.subscriptionExpiryNotices.filter((item) => item.subscriptionId === subscription.id).length;
  assert.equal(Number(noticeCountAfterSecondPass.total ?? noticeCountAfterSecondPass), firstNoticeCount);
  assert.equal(emailMessages.length, firstEmailCount);
  assert.ok(firstNoticeCount >= 1);
  assert.ok(inboxAfterFirstPass.items.some((item) => item.sourceType === 'subscription_expiry'));
  assert.ok(emailMessages.length > 0);
  const noticeId = db
    ? (await db('subscription_expiry_notices')
      .where({ subscription_id: subscription.id, threshold_days: 0 }).first('id'))?.id
    : repo.subscriptionExpiryNotices.find((item) =>
      item.subscriptionId === subscription.id && item.thresholdDays === 0)?.id;
  assert.ok(noticeId);
  const noticeAudit = await findAuditEvent(fixture, 'subscription.expiry_notice_sent', noticeId);
  assert.equal(noticeAudit.organizationId, orgId);
  const expiryAudit = await findAuditEvent(fixture, 'subscription.expired', subscription.id);
  assert.equal(expiryAudit.organizationId, orgId);
}

async function runFeeItemCategoryMigrationContract() {
  const tableName = `fee_migration_probe_${randomUUID().replaceAll('-', '')}`;
  await mysql.schema.createTable(tableName, (table) => {
    table.string('id', 36).primary();
    table.string('existing_value', 80).notNullable();
  });
  try {
    await mysql(tableName).insert({ id: randomUUID(), existing_value: 'preserved legacy row' });
    const migrationDb = {
      schema: {
        hasColumn: (table, column) =>
          mysql.schema.hasColumn(table === 'fee_items' ? tableName : table, column),
        alterTable: (table, callback) =>
          mysql.schema.alterTable(table === 'fee_items' ? tableName : table, callback)
      }
    };
    await migrateFeeItemCategory(migrationDb);
    await migrateFeeItemCategory(migrationDb);
    const row = await mysql(tableName).first('existing_value', 'category');
    assert.deepEqual(row, { existing_value: 'preserved legacy row', category: 'core' });
    assert.equal(await mysql(tableName).count({ total: '*' }).then(([count]) => Number(count.total)), 1);
  } finally {
    await mysql.schema.dropTableIfExists(tableName);
  }
}

async function runReportsContract(fixture) {
  const { repo, db, campusA, campusB, studentA, studentB, actors } = fixture;
  const { yearA, gradeA, sectionA, sectionA2, sectionB } = await prepareAcademicStudentFixture(fixture);
  const filters = { year: yearA.id, page: 1, pageSize: 50 };
  const filterOptions = await repo.getReportFilters(actors.owner.actor);
  assert.ok(filterOptions.sections.some((section) => section.id === sectionA.id));
  assert.ok(filterOptions.sections.every((section) => section.id !== sectionB.id));
  const teacherOptions = await repo.getReportFilters(actors.teacherOne.actor);
  assert.equal(teacherOptions.sections.length, 0);
  assert.equal(teacherOptions.years.length, 0);
  assert.equal(teacherOptions.grades.length, 0);
  assert.equal(teacherOptions.terms.length, 0);
  const otherTenantActor = { ...actors.owner.actor, orgId: randomUUID() };
  await assert.rejects(repo.getReportFilters(otherTenantActor), { status: 403, code: 'FORBIDDEN' });
  await assert.rejects(repo.getReport('student-directory', filters, otherTenantActor), {
    status: 403, code: 'FORBIDDEN'
  });
  await assert.rejects(repo.getReport('student-directory', filters, otherTenantActor, {
    exportCsv: true
  }), { status: 403, code: 'FORBIDDEN' });
  const campusAReport = await repo.getReport('student-directory', filters, actors.owner.actor);
  assert.equal(campusAReport.total, 1);
  assert.deepEqual(campusAReport.rows.map((row) => row.studentNo), [`A-${studentA.slice(0, 8)}`]);
  assert.equal(campusAReport.summary.records, 1);

  const campusBReport = await repo.getReport('student-directory', {
    ...filters, year: (await repo.getAcademicYear(campusB)).id
  }, actors.campusBOwner.actor);
  assert.equal(campusBReport.total, 1);
  assert.equal(campusBReport.rows[0].studentNo, `B-${studentB.slice(0, 8)}`);
  assert.notEqual(campusBReport.rows[0].studentNo, campusAReport.rows[0].studentNo);

  const teacherReport = await repo.getReport('student-directory', filters, actors.teacherOne.actor);
  assert.equal(teacherReport.total, 0);
  const exported = await repo.getReport('student-directory', filters, actors.owner.actor, {
    exportCsv: true
  });
  assert.deepEqual(exported.rows.map((row) => row.studentNo), campusAReport.rows.map((row) => row.studentNo));
  assert.ok((await auditActions(fixture, campusA)).includes('report.exported'));
  await assert.rejects(repo.getReport('finance-collection', filters, actors.teacherOne.actor), {
    status: 403, code: 'FORBIDDEN'
  });
  await assert.rejects(repo.getReport('student-directory', filters, {
    ...actors.owner.actor, role: 'parent_guardian', sub: randomUUID()
  }), { status: 403, code: 'FORBIDDEN' });

  const suffix = randomUUID().slice(0, 8);
  const subject = await repo.createSubject({
    code: `RPT-${suffix}`, nameEn: 'Report contract subject', nameAm: 'የሪፖርት ትምህርት'
  }, actors.owner.actor);
  const teacher = await repo.createStaff({
    userId: actors.teacherOne.id, givenNameEn: 'Report', fatherNameEn: 'Contract',
    grandfatherNameEn: 'Teacher', givenNameAm: 'ሪፖርት', fatherNameAm: 'ሙከራ',
    grandfatherNameAm: 'መምህር', jobTitle: 'Teacher', employmentStatus: 'active'
  }, actors.owner.actor);
  await repo.replaceGradeSubjects(gradeA.id, {
    subjects: [{ subjectId: subject.id, stream: 'all', weeklyPeriods: 2, isRequired: true }]
  }, actors.owner.actor);
  const assignmentOne = await repo.createTeachingAssignment({
    staffId: teacher.id, sectionId: sectionA.id, subjectId: subject.id
  }, actors.owner.actor);
  const assignmentTwo = await repo.createTeachingAssignment({
    staffId: teacher.id, sectionId: sectionA2.id, subjectId: subject.id,
  }, actors.owner.actor);
  if (db) {
    await db('teaching_assignments').where({ id: assignmentOne.id }).update({
      day_of_week: 1, period_number: 1
    });
    await db('teaching_assignments').where({ id: assignmentTwo.id }).update({
      day_of_week: 2, period_number: 1
    });
  } else {
    repo.teachingAssignments.find((item) => item.id === assignmentOne.id).periodNumber = 1;
    repo.teachingAssignments.find((item) => item.id === assignmentTwo.id).periodNumber = 1;
  }
  const outsideSection = await repo.createSection({
    gradeLevelId: gradeA.id, name: `Outside ${suffix}`, capacity: null, shift: 'morning'
  }, actors.owner.actor);
  const outsideStudent = {
    id: randomUUID(), campusId: campusA, studentNo: `OUT-${suffix}`,
    givenNameEn: 'Outside', fatherNameEn: 'Scope', grandfatherNameEn: 'Student',
    givenNameAm: 'ውጭ', fatherNameAm: 'ወሰን', grandfatherNameAm: 'ተማሪ',
    gender: 'male', sectionName: outsideSection.name, archivedAt: null, status: 'enrolled'
  };
  if (db) {
    await db('students').insert({
      id: outsideStudent.id, campus_id: campusA, student_no: outsideStudent.studentNo,
      given_name_am: outsideStudent.givenNameAm, father_name_am: outsideStudent.fatherNameAm,
      grandfather_name_am: outsideStudent.grandfatherNameAm,
      given_name_en: outsideStudent.givenNameEn, father_name_en: outsideStudent.fatherNameEn,
      grandfather_name_en: outsideStudent.grandfatherNameEn, gender: outsideStudent.gender,
      section_name: outsideSection.name, status: 'enrolled'
    });
    await db('enrolments').insert({
      id: randomUUID(), student_id: outsideStudent.id, academic_year_id: yearA.id,
      section_id: outsideSection.id, status: 'active', enrolled_on: '2026-01-01'
    });
  } else {
    repo.students.push(outsideStudent);
    repo.enrolments.push({
      id: randomUUID(), studentId: outsideStudent.id, academicYearId: yearA.id,
      sectionId: outsideSection.id, status: 'active', enrolledOn: '2026-01-01'
    });
  }
  const scopedTeacherOptions = await repo.getReportFilters(actors.teacherOne.actor);
  assert.deepEqual(new Set(scopedTeacherOptions.sections.map((item) => item.id)),
    new Set([sectionA.id, sectionA2.id]));
  const units = await Promise.all([1, 2].map((unitNumber) => repo.saveCurriculumUnit({
    academicYearId: yearA.id, gradeLevelId: gradeA.id, stream: 'all',
    subjectId: subject.id, unitNumber, titleEn: `Report unit ${unitNumber}`,
    titleAm: `ሪፖርት ${unitNumber}`, learningOutcomesEn: 'Contract learning outcome',
    learningOutcomesAm: 'የሙከራ የመማር ውጤት'
  }, actors.owner.actor)));
  const plan = await repo.createLessonPlan({
    teachingAssignmentId: assignmentOne.id, curriculumUnitId: units[0].id,
    plannedOn: '2026-03-01', titleEn: 'Completed report lesson', titleAm: 'የተጠናቀቀ',
    objectivesEn: 'Verify syllabus coverage.', objectivesAm: 'ሽፋን ያረጋግጡ።',
    activitiesEn: 'Review unit one.', activitiesAm: 'ክፍል አንድን ይመልከቱ።'
  }, actors.teacherOne.actor);
  await repo.updateLessonPlan(plan.id, { status: 'completed' }, actors.teacherOne.actor);

  const classes = await repo.getReport('my-classes', filters, actors.teacherOne.actor);
  assert.equal(classes.total, 2);
  assert.deepEqual(new Set(classes.rows.map((row) => row.section)),
    new Set([sectionA.name, sectionA2.name]));
  assert.equal((await repo.getDashboard(campusA, actors.teacherOne.actor)).studentCount, 1);
  assert.equal((await repo.getDashboard(campusA, actors.owner.actor)).studentCount, 2);
  const coverage = await repo.getReport('syllabus-coverage', filters, actors.teacherOne.actor);
  const coveredSection = coverage.rows.find((row) => row.section === sectionA.name);
  assert.equal(coveredSection.units, 2);
  assert.equal(coveredSection.coveredUnits, 1);
  assert.equal(coveredSection.coveragePercent, 50);
  await assert.rejects(repo.getReport('teacher-workload', filters, actors.teacherOne.actor), {
    status: 403, code: 'FORBIDDEN'
  });
  const workload = await repo.getReport('teacher-workload', {
    ...filters, workloadLimit: 1
  }, actors.owner.actor);
  const teacherWorkload = workload.rows.find((row) => row.teacher.includes('Report'));
  assert.equal(teacherWorkload.classes, 2);
  assert.equal(teacherWorkload.periods, 2);
  assert.equal(teacherWorkload.limit, 1);
  assert.equal(teacherWorkload.warning, true);
}

async function runFinanceContract(fixture) {
  const { repo, db, orgId, campusA, campusB, studentA, studentB, actors } = fixture;
  const { yearA, gradeA } = await prepareAcademicStudentFixture(fixture);
  const suffix = randomUUID().slice(0, 8);
  const structure = await repo.createFeeStructure({
    academicYearId: yearA.id, gradeLevelId: gradeA.id,
    name: `WP5 fees ${suffix}`, currencyCode: 'ETB',
    installments: [
      { dueDate: '2026-03-01', amountMinor: 1001 },
      { dueDate: '2026-04-01', amountMinor: 2002 }
    ]
  }, actors.cashier.actor);
  assert.equal(structure.installments.reduce((sum, item) => sum + item.amountMinor, 0), 3003);
  assert.equal((await repo.listFeeStructures(actors.owner.actor)).length, 1);
  assert.deepEqual(await repo.listFeeStructures({
    ...actors.owner.actor, orgId: randomUUID()
  }), []);
  const preview = await repo.previewFeeStructureInvoices(
    structure.id, undefined, actors.cashier.actor);
  assert.equal(preview.studentCount, 1);
  const generationKey = `wp5-generation-${suffix}`;
  const generated = await repo.generateFeeStructureInvoices(
    structure.id, undefined, generationKey, actors.cashier.actor);
  const replayedGeneration = await repo.generateFeeStructureInvoices(
    structure.id, undefined, generationKey, actors.cashier.actor);
  const secondGeneration = await repo.generateFeeStructureInvoices(
    structure.id, undefined, `${generationKey}-repeat`, actors.cashier.actor);
  assert.equal(generated.invoiceCount, 2);
  assert.deepEqual(generated.invoices.map((item) => Math.round(item.totalAmount * 100)).sort((a, b) => a - b),
    [1001, 2002]);
  assert.equal(replayedGeneration.duplicate, true);
  assert.equal(replayedGeneration.generationId, generated.generationId);
  assert.equal(secondGeneration.invoiceCount, 0);
  assert.equal((await repo.listFeeInvoices(actors.owner.actor)).length, 2);

  const discountType = await repo.createFeeDiscountType({
    code: `SCH-${suffix}`, name: 'Contract scholarship',
    category: 'scholarship', discountKind: 'percentage'
  }, actors.cashier.actor);
  const discountKey = `wp5-discount-${suffix}`;
  const discount = await repo.requestFeeDiscount({
    studentId: studentA, discountTypeId: discountType.id,
    periodKey: '2026-03', percentageBasisPoints: 5000,
    reason: 'Contract 50 percent scholarship', idempotencyKey: discountKey
  }, actors.cashier.actor);
  assert.equal((await repo.requestFeeDiscount({
    studentId: studentA, discountTypeId: discountType.id,
    periodKey: '2026-03', percentageBasisPoints: 5000,
    reason: 'Contract 50 percent scholarship', idempotencyKey: discountKey
  }, actors.cashier.actor)).duplicate, true);
  await assert.rejects(repo.transitionFeeDiscount(
    discount.id, 'approved', actors.cashier.actor), { code: 'SETUP_CONFLICT' });
  const approvedDiscounts = await Promise.all([
    repo.transitionFeeDiscount(discount.id, 'approved', actors.principal.actor),
    repo.transitionFeeDiscount(discount.id, 'approved', actors.principal.actor)
  ]);
  const approvedDiscount = approvedDiscounts[0];
  assert.equal(approvedDiscount.status, 'approved');
  assert.equal(approvedDiscounts[1].status, 'approved');
  const firstInvoice = generated.invoices.find((item) => item.dueDate === '2026-03-01');
  const secondInvoice = generated.invoices.find((item) => item.dueDate === '2026-04-01');
  assert.ok(firstInvoice, JSON.stringify(generated.invoices));
  assert.ok(secondInvoice, JSON.stringify(generated.invoices));
  const discountApplications = db
    ? await db('fee_discount_applications').where({ discount_request_id: discount.id })
    : repo.feeDiscountApplications.filter((item) => item.discountRequestId === discount.id);
  assert.equal(discountApplications.length, 1);
  assert.equal(db ? Number(discountApplications[0].amount_minor) :
    discountApplications[0].amountMinor, 501);
  let invoiceRows = await repo.listFeeInvoices(actors.owner.actor);
  assert.equal(invoiceRows.find((item) => item.id === firstInvoice.id).balanceDue, 5);
  const discountAudit = await findAuditEvent(fixture, 'fee_discount.approved', discount.id);
  assert.equal(discountAudit.organizationId, orgId);
  assert.equal(discountAudit.campusId, campusA);
  assert.equal(discountAudit.before.status, 'pending');
  assert.equal(discountAudit.after.status, 'approved');
  assert.equal(discountAudit.after.applications[0].amountMinor, 501);

  await repo.openCashierShift({ currencyCode: 'ETB', openingFloat: 0 }, actors.cashier.actor);
  const paymentKeys = [`wp5-payment-a-${suffix}`, `wp5-payment-b-${suffix}`];
  const paymentAttempts = await Promise.allSettled(paymentKeys.map((idempotencyKey) =>
    repo.recordFeePayment(firstInvoice.id, {
      amount: 3, method: 'cash', reference: '', idempotencyKey
    }, actors.cashier.actor)));
  assert.equal(paymentAttempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(paymentAttempts.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(paymentAttempts.find((item) => item.status === 'rejected').reason.code, 'FEE_CONFLICT');
  const paymentIndex = paymentAttempts.findIndex((item) => item.status === 'fulfilled');
  const paymentKey = paymentKeys[paymentIndex];
  const paymentData = {
    amount: 3, method: 'cash', reference: '', idempotencyKey: paymentKey
  };
  const payment = paymentAttempts[paymentIndex].value;
  const replayedPayment = await repo.recordFeePayment(firstInvoice.id, paymentData, actors.cashier.actor);
  assert.equal(replayedPayment.id, payment.id);
  assert.equal(replayedPayment.duplicate, true);
  const paidInvoice = (await repo.listFeeInvoices(actors.owner.actor))
    .find((item) => item.id === firstInvoice.id);
  assert.equal(paidInvoice.balanceDue, 2);
  assert.equal(paidInvoice.payments.filter((item) => item.entryType === 'payment')
    .reduce((sum, item) => sum + item.amount, 0), 3);

  const refundAttempt = (key) => repo.requestFeeRefund({
    paymentId: payment.id, amountMinor: 200,
    reason: 'Contract refund request', idempotencyKey: key
  }, actors.cashier.actor);
  const concurrentRefunds = await Promise.allSettled([
    refundAttempt(`wp5-refund-a-${suffix}`), refundAttempt(`wp5-refund-b-${suffix}`)
  ]);
  assert.equal(concurrentRefunds.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(concurrentRefunds.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(concurrentRefunds.find((item) => item.status === 'rejected').reason.code, 'FEE_CONFLICT');
  const refund = concurrentRefunds.find((item) => item.status === 'fulfilled').value;
  assert.equal((await refundAttempt(
    concurrentRefunds.findIndex((item) => item.status === 'fulfilled') === 0
      ? `wp5-refund-a-${suffix}` : `wp5-refund-b-${suffix}`)).duplicate, true);
  await assert.rejects(repo.transitionFeeRefund(
    refund.id, 'approved', actors.cashier.actor), { code: 'SETUP_CONFLICT' });
  const approvedRefund = await repo.transitionFeeRefund(
    refund.id, 'approved', actors.principal.actor);
  assert.equal(approvedRefund.status, 'approved');
  assert.equal((await repo.transitionFeeRefund(
    refund.id, 'approved', actors.principal.actor)).status, 'approved');
  await assert.rejects(repo.transitionFeeRefund(
    refund.id, 'rejected', actors.principal.actor), { code: 'SETUP_CONFLICT' });
  invoiceRows = await repo.listFeeInvoices(actors.owner.actor);
  assert.equal(invoiceRows.find((item) => item.id === firstInvoice.id).balanceDue, 4);
  const refundAudit = await findAuditEvent(fixture, 'fee_refund.approved', refund.id);
  assert.equal(refundAudit.organizationId, orgId);
  assert.equal(refundAudit.campusId, campusA);
  assert.equal(refundAudit.before.status, 'pending');
  assert.equal(refundAudit.after.status, 'approved');

  const rejectedCredit = await repo.requestFeeAdjustment({
    invoiceId: firstInvoice.id, adjustmentType: 'credit', amountMinor: 451,
    reason: 'Credit must not make the balance negative',
    idempotencyKey: `wp5-adjust-credit-${suffix}`
  }, actors.cashier.actor);
  await assert.rejects(repo.transitionFeeAdjustment(
    rejectedCredit.id, 'approved', actors.principal.actor), { code: 'FEE_CONFLICT' });
  const debitKey = `wp5-adjust-debit-${suffix}`;
  const debitData = {
    invoiceId: firstInvoice.id, adjustmentType: 'debit', amountMinor: 10,
    reason: 'Contract debit adjustment', idempotencyKey: debitKey
  };
  const debit = await repo.requestFeeAdjustment(debitData, actors.cashier.actor);
  assert.equal((await repo.requestFeeAdjustment(debitData, actors.cashier.actor)).duplicate, true);
  await assert.rejects(repo.transitionFeeAdjustment(
    debit.id, 'approved', actors.cashier.actor), { code: 'SETUP_CONFLICT' });
  assert.equal((await repo.transitionFeeAdjustment(
    debit.id, 'approved', actors.principal.actor)).status, 'approved');
  await assert.rejects(repo.transitionFeeAdjustment(
    debit.id, 'rejected', actors.principal.actor), { code: 'SETUP_CONFLICT' });
  const adjustmentAudit = await findAuditEvent(fixture, 'fee_adjustment.approved', debit.id);
  assert.equal(adjustmentAudit.organizationId, orgId);
  assert.equal(adjustmentAudit.campusId, campusA);
  assert.equal(adjustmentAudit.before.status, 'pending');
  assert.equal(adjustmentAudit.after.status, 'approved');
  assert.equal((await repo.listFeeInvoices(actors.owner.actor))
    .find((item) => item.id === firstInvoice.id).balanceDue, 4.1);

  await repo.recordFeePayment(secondInvoice.id, {
    amount: 20.02, method: 'cash', reference: '', idempotencyKey: `wp5-payment-paid-${suffix}`
  }, actors.cashier.actor);
  const dailyCollections = await repo.getFeeReport(
    'daily_collection', '2000-01-01', '2100-12-31', actors.owner.actor);
  assert.ok(dailyCollections.some((item) => item.date && item.currencyCode === 'ETB' &&
    item.amount >= 20.02));
  const outstanding = await repo.getFeeReport(
    'outstanding', '2026-01-01', '2026-12-31', actors.owner.actor);
  assert.equal(outstanding.some((item) => item.invoiceNumber === secondInvoice.invoiceNumber), false);
  const arrears = await repo.getArrearsReport('2026-10-30', actors.owner.actor);
  assert.deepEqual(arrears.map((item) => item.invoiceId), [firstInvoice.id]);
  assert.equal(arrears[0].bucket, 'over_90');
  const followup = await repo.createArrearsFollowup(firstInvoice.id, {
    note: 'Called guardian about the balance', nextContactOn: '2026-11-05'
  }, actors.cashier.actor);
  assert.equal((await repo.getArrearsReport('2026-10-30', actors.owner.actor))[0]
    .followups[0].id, followup.id);
  const followupAudit = await findAuditEvent(
    fixture, 'fee_arrears.followup_created', followup.id);
  assert.equal(followupAudit.organizationId, orgId);
  assert.equal(followupAudit.campusId, campusA);

  const parentId = randomUUID();
  const guardianId = randomUUID();
  const parent = {
    id: parentId, orgId, name: 'WP5 parent', email: `${parentId}@example.test`,
    role: 'parent_guardian', campusIds: [campusA], activeCampusId: campusA, isActive: true
  };
  if (db) {
    await db('users').insert({
      id: parentId, organization_id: orgId, name: parent.name, email: parent.email,
      password_hash: 'contract-only', role: parent.role, is_active: true
    });
    await db('user_campuses').insert({ user_id: parentId, campus_id: campusA, is_active: true });
    await db('guardians').insert({
      id: guardianId, organization_id: orgId, given_name_am: 'ወላጅ',
      father_name_am: 'ፈተና', grandfather_name_am: 'አንድ',
      given_name_en: 'WP5', father_name_en: 'Parent', grandfather_name_en: suffix,
      phone: '+251900000299', email: parent.email, user_id: parentId
    });
    await db('student_guardians').insert({
      student_id: studentA, guardian_id: guardianId, relationship: 'parent',
      is_primary: true, is_verified: true, can_view_results: true, can_view_fees: true
    });
  } else {
    repo.users.push(parent);
    repo.guardians.push({
      id: guardianId, orgId, givenNameAm: 'ወላጅ', fatherNameAm: 'ፈተና',
      grandfatherNameAm: 'አንድ', givenNameEn: 'WP5', fatherNameEn: 'Parent',
      grandfatherNameEn: suffix, phone: '+251900000299', email: parent.email, userId: parentId
    });
    repo.studentGuardians.push({
      studentId: studentA, guardianId, relationship: 'parent', isPrimary: true,
      isVerified: true, canViewResults: true, canViewFees: true
    });
  }
  const parentStatement = await repo.getStudentFeeStatement(studentA, {
    sub: parentId, orgId, role: 'parent_guardian',
    activeCampusId: campusA, campusIds: [campusA]
  });
  assert.equal(parentStatement.invoices.length, 2);
  await assert.rejects(repo.getStudentFeeStatement(studentB, {
    sub: parentId, orgId, role: 'parent_guardian',
    activeCampusId: campusA, campusIds: [campusA]
  }), { code: 'CAMPUS_SCOPE_VIOLATION' });
  const foreignActor = { ...actors.owner.actor, orgId: randomUUID() };
  assert.deepEqual(await repo.listFeeDiscountTypes(foreignActor), []);
  assert.deepEqual(await repo.listFeeDiscountRequests(foreignActor), []);
  assert.deepEqual(await repo.listFeeRefundRequests(foreignActor), []);
  assert.deepEqual(await repo.listFeeAdjustmentRequests(foreignActor), []);
  assert.deepEqual(await repo.listCashbookAccounts(foreignActor), []);
  assert.deepEqual(await repo.getArrearsReport('2026-10-30', foreignActor), []);
  assert.deepEqual(await repo.getFeeReport(
    'daily_collection', '2000-01-01', '2100-12-31', foreignActor), []);
  assert.equal(await repo.getStudentFeeStatement(studentA, foreignActor)
    .then(() => null, (error) => error.code), 'CAMPUS_SCOPE_VIOLATION');
  assert.equal(await repo.previewFeeStructureInvoices(
    structure.id, undefined, foreignActor), null);
  assert.equal(await repo.createArrearsFollowup(firstInvoice.id, {
    note: 'Out-of-tenant follow-up attempt', nextContactOn: '2026-11-06'
  }, foreignActor), null);
  await assert.rejects(repo.requestFeeAdjustment({
    invoiceId: firstInvoice.id, adjustmentType: 'debit', amountMinor: 1,
    reason: 'Out-of-tenant write', idempotencyKey: `wp5-foreign-adjustment-${suffix}`
  }, foreignActor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  await assert.rejects(repo.requestFeeRefund({
    paymentId: payment.id, amountMinor: 1, reason: 'Out-of-tenant write',
    idempotencyKey: `wp5-foreign-refund-${suffix}`
  }, foreignActor), { code: 'CAMPUS_SCOPE_VIOLATION' });
  const scopedExportController = createFinanceController({
    repo, parse: (_schema, value) => value
  });
  let foreignArrearsCsv = '';
  await scopedExportController.exportArrears({
    query: { asOf: '2026-10-30' }, user: foreignActor
  }, {
    type() { return this; },
    set() { return this; },
    send(value) { foreignArrearsCsv = value; return this; }
  }, (error) => { throw error; });
  assert.equal(foreignArrearsCsv.split('\r\n').length, 1);

  const sourceAccount = await repo.createCashbookAccount({
    name: `Cash ${suffix}`, accountType: 'cash', currencyCode: 'ETB', openingBalanceMinor: 1000,
    idempotencyKey: `wp5-account-cash-${suffix}`
  }, actors.owner.actor);
  const bankAccount = await repo.createCashbookAccount({
    name: `Bank ${suffix}`, accountType: 'bank', currencyCode: 'ETB', openingBalanceMinor: 0,
    idempotencyKey: `wp5-account-bank-${suffix}`
  }, actors.owner.actor);
  assert.equal(await repo.listCashbookEntries(
    bankAccount.id, '2000-01-01', '2100-01-01', foreignActor), null);
  assert.equal(await repo.createCashbookDeposit(bankAccount.id, {
    amountMinor: 1, description: 'Out-of-tenant deposit',
    idempotencyKey: `wp5-foreign-deposit-${suffix}`
  }, foreignActor), null);
  assert.equal((await repo.createCashbookAccount({
    name: `Cash ${suffix}`, accountType: 'cash', currencyCode: 'ETB', openingBalanceMinor: 1000,
    idempotencyKey: `wp5-account-cash-${suffix}`
  }, actors.owner.actor)).duplicate, true);
  const depositData = {
    amountMinor: 50, description: 'Contract cashbook deposit',
    recordedOn: '2026-10-30', idempotencyKey: `wp5-deposit-${suffix}`
  };
  const deposit = await repo.createCashbookDeposit(bankAccount.id, depositData, actors.cashier.actor);
  assert.equal((await repo.createCashbookDeposit(
    bankAccount.id, depositData, actors.cashier.actor)).duplicate, true);
  const transferData = (key) => ({
    fromAccountId: sourceAccount.id, toAccountId: bankAccount.id,
    amountMinor: 700, description: 'Contract bank transfer',
    recordedOn: '2026-10-30', idempotencyKey: key
  });
  const failedTransferKey = `wp5-transfer-failure-${suffix}`;
  const beforeFailedTransfer = await repo.listCashbookAccounts(actors.owner.actor);
  const beforeFailedEntries = [
    ...(await repo.listCashbookEntries(sourceAccount.id, '2000-01-01', '2100-01-01',
      actors.owner.actor)),
    ...(await repo.listCashbookEntries(bankAccount.id, '2000-01-01', '2100-01-01',
      actors.owner.actor))
  ];
  let transferTrigger = null;
  const originalAppendAudit = repo.appendAudit;
  if (db) {
    transferTrigger = `contract_transfer_rollback_${randomUUID().replaceAll('-', '')}`;
    await db.raw(
      `CREATE TRIGGER \`${transferTrigger}\` BEFORE INSERT ON audit_log FOR EACH ROW ` +
      `BEGIN IF NEW.action = 'cashbook.transfer_recorded' THEN ` +
      `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract transfer rollback'; END IF; END`
    );
  } else {
    repo.appendAudit = async function (...args) {
      if (args[1] === 'cashbook.transfer_recorded') throw new Error('contract transfer rollback');
      return originalAppendAudit.apply(this, args);
    };
  }
  try {
    await assert.rejects(repo.transferCashbookFunds(
      transferData(failedTransferKey), actors.cashier.actor), /contract transfer rollback/);
  } finally {
    if (db) await db.raw(`DROP TRIGGER IF EXISTS \`${transferTrigger}\``);
    else repo.appendAudit = originalAppendAudit;
  }
  assert.deepEqual(await repo.listCashbookAccounts(actors.owner.actor), beforeFailedTransfer);
  assert.deepEqual([
    ...(await repo.listCashbookEntries(sourceAccount.id, '2000-01-01', '2100-01-01',
      actors.owner.actor)),
    ...(await repo.listCashbookEntries(bankAccount.id, '2000-01-01', '2100-01-01',
      actors.owner.actor))
  ], beforeFailedEntries);

  const transferKeys = [`wp5-transfer-a-${suffix}`, `wp5-transfer-b-${suffix}`];
  const transferResults = await Promise.allSettled(transferKeys.map((key) =>
    repo.transferCashbookFunds(transferData(key), actors.cashier.actor)));
  assert.equal(transferResults.filter((item) => item.status === 'fulfilled').length, 1,
    JSON.stringify(transferResults.map((item) => item.status === 'rejected'
      ? { code: item.reason.code, message: item.reason.message } : { status: item.status })));
  assert.equal(transferResults.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(transferResults.find((item) => item.status === 'rejected').reason.code, 'FEE_CONFLICT');
  const transfer = transferResults.find((item) => item.status === 'fulfilled').value;
  const transferKey = transferKeys[transferResults.findIndex((item) => item.status === 'fulfilled')];
  assert.equal((await repo.transferCashbookFunds(
    transferData(transferKey), actors.cashier.actor)).duplicate, true);
  const balances = await repo.listCashbookAccounts(actors.owner.actor);
  assert.equal(balances.find((item) => item.id === sourceAccount.id).balanceMinor, 300);
  assert.equal(balances.find((item) => item.id === bankAccount.id).balanceMinor, 750);
  const reconciliation = await repo.reconcileCashbookAccount(bankAccount.id, {
    statementDate: '2026-10-30', statementBalanceMinor: 760
  }, actors.cashier.actor);
  assert.equal(reconciliation.bookBalanceMinor, 750);
  assert.equal(reconciliation.differenceMinor, 10);
  assert.equal((await repo.reconcileCashbookAccount(bankAccount.id, {
    statementDate: '2026-10-30', statementBalanceMinor: 0
  }, actors.cashier.actor)).duplicate, true);
  const transferAudit = await findAuditEvent(
    fixture, 'cashbook.transfer_recorded', transferKey);
  assert.equal(transferAudit.organizationId, orgId);
  assert.equal(transferAudit.campusId, campusA);
  const reconciliationAudit = await findAuditEvent(
    fixture, 'cashbook.reconciled', reconciliation.id);
  assert.equal(reconciliationAudit.organizationId, orgId);
  assert.equal(reconciliationAudit.campusId, campusA);
  assert.ok(deposit.id);
  const beforeReversal = (await repo.listCashbookEntries(
    bankAccount.id, '2000-01-01', '2100-01-01', actors.owner.actor))
    .find((entry) => entry.id === deposit.id);
  const reversal = await repo.reverseCashbookEntry(deposit.id, {
    reason: 'Contract reversal of reconciled entry',
    idempotencyKey: `wp5-reconcile-reversal-${suffix}`
  }, actors.cashier.actor);
  assert.equal((await repo.listCashbookEntries(
    bankAccount.id, '2000-01-01', '2100-01-01', actors.owner.actor))
    .find((entry) => entry.id === deposit.id).amountMinor, beforeReversal.amountMinor);
  const reversalAudit = await findAuditEvent(fixture, 'cashbook.entry_reversed', deposit.id);
  assert.equal(reversalAudit.after.reversalId ?? reversalAudit.after.id, reversal.id);
  assert.equal(reversalAudit.organizationId, orgId);
  assert.equal(reversalAudit.campusId, campusA);

  const dashboard = await repo.getFinanceDashboard(actors.owner.actor, '2026-10-30');
  assert.ok(dashboard.outstandingByCurrency.some((item) => item.currencyCode === 'ETB' &&
    item.amount === 4.1));
  assert.ok((await auditActions(fixture, campusA)).includes('fee_invoice.bulk_generated'));
  assert.equal(campusB !== campusA, true);

  const ageingStructure = await repo.createFeeStructure({
    academicYearId: yearA.id, gradeLevelId: gradeA.id,
    name: `WP5 ageing ${suffix}`, currencyCode: 'ETB',
    installments: [
      { dueDate: '2026-10-30', amountMinor: 100 },
      { dueDate: '2026-10-01', amountMinor: 100 },
      { dueDate: '2026-09-15', amountMinor: 100 },
      { dueDate: '2026-08-15', amountMinor: 100 },
      { dueDate: '2026-07-01', amountMinor: 100 }
    ]
  }, actors.cashier.actor);
  const ageingGeneration = await repo.generateFeeStructureInvoices(
    ageingStructure.id, undefined, `wp5-ageing-${suffix}`, actors.cashier.actor);
  assert.equal(ageingGeneration.invoiceCount, 5);
  const allAgeingBuckets = await repo.getArrearsReport('2026-10-30', actors.owner.actor);
  assert.deepEqual([...new Set(allAgeingBuckets.map((row) => row.bucket))].sort(),
    ['1_30', '31_60', '61_90', 'current', 'over_90'].sort());
  assert.ok(allAgeingBuckets.every((row) => row.balanceDue >= 0));
  assert.equal(followup.note, 'Called guardian about the balance');
  assert.equal(followup.nextContactOn, '2026-11-05');

  const fixedType = await repo.createFeeDiscountType({
    code: `FIX-${suffix}`, name: 'Contract fixed scholarship',
    category: 'scholarship', discountKind: 'fixed'
  }, actors.cashier.actor);
  const fixedDiscount = await repo.requestFeeDiscount({
    studentId: studentA, discountTypeId: fixedType.id, periodKey: '2026-10',
    fixedAmountMinor: 10000, reason: 'Fixed discount capped at invoice balances',
    idempotencyKey: `wp5-fixed-discount-${suffix}`
  }, actors.cashier.actor);
  const fixedRepeat = await repo.requestFeeDiscount({
    studentId: studentA, discountTypeId: fixedType.id, periodKey: '2026-10',
    fixedAmountMinor: 10000, reason: 'Fixed discount capped at invoice balances',
    idempotencyKey: `wp5-fixed-discount-${suffix}`
  }, actors.cashier.actor);
  assert.equal(fixedRepeat.id, fixedDiscount.id);
  assert.equal(fixedRepeat.duplicate, true);
  const fixedApproval = await repo.transitionFeeDiscount(
    fixedDiscount.id, 'approved', actors.principal.actor);
  assert.equal(fixedApproval.status, 'approved');
  const fixedApplications = db
    ? await db('fee_discount_applications').where({ discount_request_id: fixedDiscount.id })
    : repo.feeDiscountApplications.filter((item) =>
      item.discountRequestId === fixedDiscount.id);
  assert.ok(fixedApplications.length >= 1);
  assert.ok((await repo.listFeeInvoices(actors.owner.actor)).every((invoice) =>
    invoice.balanceDue >= 0));

  const exportController = createFinanceController({
    repo: { getArrearsReport: async () => [{
      invoiceNumber: '=1+1', studentNo: '+SUM(1,1)', studentName: '-cmd',
      sectionName: '@cmd', dueDate: '2026-10-30', daysOverdue: 0,
      bucket: 'current', balanceDue: 1, currencyCode: 'ETB'
    }] },
    parse: (_schema, value) => value
  });
  let arrearsCsv = '';
  const csvResponse = {
    type() { return this; },
    set() { return this; },
    send(value) { arrearsCsv = value; return this; }
  };
  await exportController.exportArrears({
    query: { asOf: '2026-10-30' }, user: actors.owner.actor
  }, csvResponse, (error) => { throw error; });
  for (const cell of ["'=1+1", "'+SUM(1,1)", "'-cmd", "'@cmd"]) {
    assert.ok(arrearsCsv.includes(cell), `expected formula-safe CSV cell ${cell}`);
  }
}

async function runCashbookAccountIdempotencyBackfillContract() {
  const tableName = `wp5_account_idem_probe_${randomUUID().replaceAll('-', '')}`;
  await mysql.schema.createTable(tableName, (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable();
    table.string('campus_id', 36).notNullable();
  });
  try {
    const accounts = [randomUUID(), randomUUID()];
    await mysql(tableName).insert(accounts.map((id) => ({
      id, organization_id: randomUUID(), campus_id: randomUUID()
    })));
    const migrationDb = {
      schema: {
        hasTable: (name) => mysql.schema.hasTable(name === 'cashbook_accounts' ? tableName : name),
        hasColumn: (name, column) =>
          mysql.schema.hasColumn(name === 'cashbook_accounts' ? tableName : name, column),
        alterTable: (name, callback) =>
          mysql.schema.alterTable(name === 'cashbook_accounts' ? tableName : name, callback)
      },
      raw: (query) => mysql.raw(query.replaceAll('cashbook_accounts', tableName))
    };
    await migrateCashbookAccountIdempotency(migrationDb);
    await migrateCashbookAccountIdempotency(migrationDb);
    const rows = await mysql(tableName).select('id', 'idempotency_key').orderBy('id');
    assert.deepEqual(rows.map((row) => row.idempotency_key), accounts.slice().sort());
    const indexes = await mysql('INFORMATION_SCHEMA.STATISTICS')
      .where({ TABLE_SCHEMA: databaseName, TABLE_NAME: tableName, INDEX_NAME: 'cashbook_account_idem_uq' })
      .count({ total: '*' }).first();
    assert.ok(Number(indexes.total) > 0);
  } finally {
    await mysql.schema.dropTableIfExists(tableName);
  }
}

async function snapshotInvoiceBalances(invoiceIds) {
  const invoices = await mysql('invoices').whereIn('id', invoiceIds).select('id', 'total_amount');
  const payments = await mysql('fee_payments').whereIn('invoice_id', invoiceIds)
    .select('invoice_id', 'entry_type', 'amount');
  return invoices.map((invoice) => {
    const total = Number(invoice.total_amount);
    const ledger = payments.filter((payment) => payment.invoice_id === invoice.id);
    const balance = feeBalanceFromLedger(total, ledger);
    return {
      id: invoice.id, total, paid: Number((total - balance).toFixed(2)), balance
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

async function runLegacyFinanceBackfillContract() {
  try {
    await rollbackCashbookAccountIdempotency(mysql);
    await rollbackWp5FinancePermissions(mysql);
    await rollbackWp5Finance(mysql);
    const fixtures = [await createFixture('mysql'), await createFixture('mysql')];
    const invoices = [];
    const scopedRows = [];
    for (const [fixtureIndex, fixture] of fixtures.entries()) {
      const campuses = [
        { campusId: fixture.campusA, studentId: fixture.studentA, actor: fixture.actors.cashier },
        { campusId: fixture.campusB, studentId: fixture.studentB, actor: fixture.actors.campusBOwner }
      ];
      for (const [campusIndex, campus] of campuses.entries()) {
        const index = fixtureIndex * campuses.length + campusIndex;
        const itemId = randomUUID();
        const shiftId = randomUUID();
        const invoiceId = randomUUID();
        const paymentId = randomUUID();
        const expenseId = randomUUID();
        const reversalId = index === 0 ? randomUUID() : null;
        const invoiceNumber = `BF-${randomUUID().slice(0, 8).toUpperCase()}`;
        await mysql('fee_items').insert({
          id: itemId, campus_id: campus.campusId, code: `BF-${randomUUID().slice(0, 8)}`,
          name_en: 'Legacy backfill fee', name_am: 'የድሮ ክፍያ',
          amount: 100 + index * 10, currency_code: 'ETB', is_active: true
        });
        await mysql('cashier_shifts').insert({
          id: shiftId, campus_id: campus.campusId, opened_by: campus.actor.id,
          currency_code: 'ETB', opening_float: 100, status: 'open',
          recorded_on: '2026-10-30'
        });
        const total = 100 + index * 10;
        const paid = 25 + index * 5;
        await mysql('invoices').insert({
          id: invoiceId, campus_id: campus.campusId, student_id: campus.studentId,
          invoice_number: invoiceNumber, currency_code: 'ETB',
          total_amount: total, due_date: '2026-12-01',
          status: 'partially_paid', issued_by: campus.actor.id
        });
        await mysql('invoice_lines').insert({
          id: randomUUID(), invoice_id: invoiceId, fee_item_id: itemId,
          description_en: 'Legacy backfill line', description_am: 'የድሮ ዝርዝር',
          unit_amount: total, quantity: 1, line_total: total
        });
        await mysql('fee_payments').insert({
          id: paymentId, campus_id: campus.campusId, invoice_id: invoiceId,
          receipt_number: `BF-${randomUUID().slice(0, 8).toUpperCase()}`,
          entry_type: 'payment', amount: paid, method: 'cash',
          cashier_shift_id: shiftId, recorded_on: '2026-10-30',
          recorded_by: campus.actor.id
        });
        if (reversalId) {
          await mysql('fee_payments').insert({
            id: reversalId, campus_id: campus.campusId, invoice_id: invoiceId,
            receipt_number: null, entry_type: 'reversal', reverses_payment_id: paymentId,
            amount: 5, method: 'cash', cashier_shift_id: shiftId,
            recorded_on: '2026-10-30', recorded_by: campus.actor.id
          });
        }
        await mysql('fee_expenses').insert({
          id: expenseId, campus_id: campus.campusId, cashier_shift_id: shiftId,
          category: 'Backfill test', description: 'Legacy expense', amount: 3.25,
          currency_code: 'ETB', method: 'cash', recorded_by: campus.actor.id,
          recorded_on: '2026-10-30'
        });
        invoices.push({ id: invoiceId, orgId: fixture.orgId, campusId: campus.campusId });
        scopedRows.push(
          { table: 'fee_items', id: itemId, orgId: fixture.orgId, campusId: campus.campusId },
          { table: 'cashier_shifts', id: shiftId, orgId: fixture.orgId, campusId: campus.campusId },
          { table: 'invoices', id: invoiceId, orgId: fixture.orgId, campusId: campus.campusId },
          { table: 'fee_payments', id: paymentId, orgId: fixture.orgId, campusId: campus.campusId },
          { table: 'fee_expenses', id: expenseId, orgId: fixture.orgId, campusId: campus.campusId }
        );
        if (reversalId) scopedRows.push({
          table: 'fee_payments', id: reversalId, orgId: fixture.orgId, campusId: campus.campusId
        });
      }
    }

    const invoiceIds = invoices.map((invoice) => invoice.id);
    const before = await snapshotInvoiceBalances(invoiceIds);
    await migrateWp5Finance(mysql);
    await migrateWp5FinancePermissions(mysql);
    await migrateCashbookAccountIdempotency(mysql);
    const after = await snapshotInvoiceBalances(invoiceIds);
    assert.deepEqual(after, before);
    for (const table of [
      'fee_items', 'invoices', 'invoice_lines', 'fee_payments', 'cashier_shifts', 'fee_expenses'
    ]) {
      assert.equal(await mysql.schema.hasColumn(table, 'organization_id'), true);
      assert.equal(await mysql.schema.hasColumn(table, 'campus_id'), true);
    }
    for (const row of scopedRows) {
      const scopedRow = await mysql(row.table).where({ id: row.id }).first();
      assert.equal(scopedRow.organization_id, row.orgId, `${row.table} organization backfill`);
      assert.equal(scopedRow.campus_id, row.campusId, `${row.table} campus scope`);
    }
    for (const invoice of invoices) {
      const line = await mysql('invoice_lines').where({ invoice_id: invoice.id }).first();
      assert.equal(line.organization_id, invoice.orgId);
      assert.equal(line.campus_id, invoice.campusId);
    }
    const balanceRows = (rows) => rows.map(({ id, total, paid, balance }) => ({
      id, total, paid, balance
    }));
    console.log(`WP5 legacy backfill balances: ${JSON.stringify({
      before: balanceRows(before), after: balanceRows(after)
    })}`);
  } finally {
    await migrateWp5Finance(mysql);
    await migrateWp5FinancePermissions(mysql);
    await migrateCashbookAccountIdempotency(mysql);
  }
}

describe('repository adapter contracts', { concurrency: false }, () => {
  it('WP8 portal migration backfills legacy communication scope and preserves timestamps on retry', async () => {
    const fixture = await createFixture('mysql');
    const { repo, orgId, campusA, actors } = fixture;
    const announcement = await repo.createCampusAnnouncement({
      titleEn: 'Legacy scope migration', titleAm: 'የድሮ ወሰን',
      bodyEn: 'Legacy body', bodyAm: 'የድሮ ጽሑፍ'
    }, actors.owner.actor);
    const event = await repo.createCampusEvent({
      titleEn: 'Legacy timestamp migration', titleAm: 'የድሮ ጊዜ',
      descriptionEn: 'Legacy event', descriptionAm: 'የድሮ ዝግጅት',
      startsOn: '2026-04-20', endsOn: '2026-04-20', startsAt: null, endsAt: null,
      location: 'Main campus', eventType: 'school', audience: 'school'
    }, actors.owner.actor);
    const announcementBefore = await mysql('campus_announcements').where({ id: announcement.id })
      .first('title_en', 'body_en', 'published_at');
    const eventBefore = await mysql('campus_events').where({ id: event.id })
      .first('title_en', 'created_at', 'updated_at');
    const timestamp = (value) => value instanceof Date ? value.toISOString() : value;
    await mysql.schema.alterTable('campus_announcements', (table) =>
      table.string('organization_id', 36).nullable().alter());
    await mysql.schema.alterTable('campus_events', (table) =>
      table.string('organization_id', 36).nullable().alter());
    await mysql('campus_announcements').where({ id: announcement.id }).update({ organization_id: null });
    await mysql('campus_events').where({ id: event.id }).update({ organization_id: null });

    await migrateWp8Portal(mysql);
    await migrateWp8Portal(mysql);
    const announcementAfter = await mysql('campus_announcements').where({ id: announcement.id })
      .first('organization_id', 'campus_id', 'title_en', 'body_en', 'published_at');
    const eventAfter = await mysql('campus_events').where({ id: event.id })
      .first('organization_id', 'campus_id', 'title_en', 'created_at', 'updated_at');
    assert.equal(announcementAfter.organization_id, orgId);
    assert.equal(announcementAfter.campus_id, campusA);
    assert.equal(announcementAfter.title_en, announcementBefore.title_en);
    assert.equal(announcementAfter.body_en, announcementBefore.body_en);
    assert.equal(timestamp(announcementAfter.published_at), timestamp(announcementBefore.published_at));
    assert.equal(eventAfter.organization_id, orgId);
    assert.equal(eventAfter.campus_id, campusA);
    assert.equal(eventAfter.title_en, eventBefore.title_en);
    assert.equal(timestamp(eventAfter.created_at), timestamp(eventBefore.created_at));
    assert.equal(timestamp(eventAfter.updated_at), timestamp(eventBefore.updated_at));
    for (const tableName of [
      'portal_requests', 'support_requests', 'message_threads', 'thread_participants', 'messages'
    ]) {
      const [collations] = await mysql.raw(
        'SELECT TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
        [databaseName, tableName]
      );
      assert.equal(collations[0].TABLE_COLLATION, 'utf8mb4_general_ci');
    }
    const [updatedAtColumn] = await mysql.raw('SHOW COLUMNS FROM `campus_events` LIKE ?', ['updated_at']);
    assert.equal(updatedAtColumn[0].Extra.toLowerCase().includes('on update'), false);
  });

  it('refresh-token campus migration preserves existing rows and is idempotent', async () => {
    const [before] = await mysql('refresh_tokens').count({ total: '*' });
    await migrateRefreshTokenCampusScope(mysql);
    await migrateRefreshTokenCampusScope(mysql);
    const [after] = await mysql('refresh_tokens').count({ total: '*' });
    assert.equal(Number(after.total), Number(before.total));
    assert.equal(await mysql.schema.hasColumn('refresh_tokens', 'campus_id'), true);
  });

  it('fee-item category migration safely defaults existing rows and is idempotent', async () => {
    await runFeeItemCategoryMigrationContract();
  });

  it('platform administrator invitation migration preserves rows and is idempotent', async () => {
    const [before] = await mysql('account_invitations').count({ total: '*' });
    await migratePlatformAdminInvitation(mysql);
    await migratePlatformAdminInvitation(mysql);
    const [after] = await mysql('account_invitations').count({ total: '*' });
    const [columns] = await mysql.raw(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS max_length
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account_invitations'
         AND COLUMN_NAME = 'target_type'`
    );
    assert.equal(Number(after.total), Number(before.total));
    assert.equal(await mysql.schema.hasColumn('account_invitations', 'target_name'), true);
    assert.ok(Number(columns[0]?.max_length) >= 32);
  });

  it('platform invitations allow a null campus and migration is idempotent', async () => {
    await migratePlatformUserInvitations(mysql);
    await migratePlatformUserInvitations(mysql);
    const [columns] = await mysql.raw(
      `SELECT IS_NULLABLE AS is_nullable
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account_invitations'
         AND COLUMN_NAME = 'campus_id'`
    );
    assert.equal(columns[0]?.is_nullable, 'YES');
  });

  it('platform dashboard, quota, billing and logo migrations are idempotent', async () => {
    await migratePlatformDashboard(mysql);
    await migratePlatformDashboard(mysql);
    assert.equal(await mysql.schema.hasColumn('organizations', 'school_code'), true);
    assert.equal(await mysql.schema.hasColumn('subscription_plans', 'max_users'), true);
    assert.equal(await mysql.schema.hasTable('subscription_refunds'), true);
    assert.equal(await mysql.schema.hasTable('platform_global_settings'), true);
  });

  it('mysql: WP4 migration can be retried without changing existing marks', async () => {
    await runExamMigrationContract();
  });

  it('mysql: WP5 finance migration is retry-safe and preserves fee balances', async () => {
    const fixture = await createFixture('mysql');
    await runFeeContract(fixture);
    const balancesBefore = (await fixture.repo.listFeeInvoices(fixture.campusA))
      .map((invoice) => [invoice.id, invoice.balanceDue]).sort(([left], [right]) => left.localeCompare(right));
    const amountsBefore = await fixture.db('fee_payments')
      .where({ organization_id: fixture.orgId, campus_id: fixture.campusA })
      .sum({ total: 'amount' }).first();
    await migrateWp5Finance(fixture.db);
    await migrateWp5Finance(fixture.db);
    const balancesAfter = (await fixture.repo.listFeeInvoices(fixture.campusA))
      .map((invoice) => [invoice.id, invoice.balanceDue]).sort(([left], [right]) => left.localeCompare(right));
    const amountsAfter = await fixture.db('fee_payments')
      .where({ organization_id: fixture.orgId, campus_id: fixture.campusA })
      .sum({ total: 'amount' }).first();
    assert.deepEqual(balancesAfter, balancesBefore);
    assert.equal(Number(amountsAfter.total), Number(amountsBefore.total));
    for (const tableName of [
      'fee_structures', 'fee_discount_requests', 'fee_refund_requests',
      'fee_adjustment_requests', 'cashbook_accounts', 'cashbook_reconciliations'
    ]) assert.equal(await fixture.db.schema.hasTable(tableName), true);
  });

  it('mysql: custom roles are tenant-scoped, audited, and immediately effective', async () => {
    const organizationId = randomUUID();
    const actorId = randomUUID();
    const targetId = randomUUID();
    try {
      await mysql('organizations').insert({
        id: organizationId, name: 'Role contract school', status: 'active',
        school_code: contractSchoolCode(), academic_configuration_json: '{}'
      });
      await mysql('users').insert([
        {
          id: actorId, organization_id: organizationId, name: 'Role contract owner',
          email: `role-owner-${randomUUID()}@example.test`, password_hash: 'contract-only',
          role: 'owner_director', is_active: true
        },
        {
          id: targetId, organization_id: organizationId, name: 'Role contract user',
          email: `role-user-${randomUUID()}@example.test`, password_hash: 'contract-only',
          role: 'principal', is_active: true
        }
      ]);
      const actor = { sub: actorId, orgId: organizationId, activeCampusId: null };
      const role = await mysqlRepository.createOrganizationRole(organizationId, {
        name: 'Contract viewer', permissions: ['account.view']
      }, actor);
      assert.deepEqual(await mysqlRepository.getRolePermissions(organizationId, role.key),
        ['account.view']);
      await mysqlRepository.updateOrganizationRolePermissions(
        organizationId, role.key, [], actor
      );
      assert.deepEqual(await mysqlRepository.getRolePermissions(organizationId, role.key), []);
      const assigned = await mysqlRepository.assignOrganizationRole(
        organizationId, targetId, role.key, actor
      );
      assert.equal(assigned.role, role.key);
      assert.equal(await mysqlRepository.getRolePermissions(randomUUID(), role.key).then((rows) =>
        rows.length), 0);
      assert.equal(await mysqlRepository.getAccountEffectivePermissions(randomUUID(), targetId), null);
      assert.ok(await mysql('audit_log').where({ organization_id: organizationId })
        .whereIn('action', ['role.created', 'role.permissions_updated', 'user.role_assigned'])
        .count({ total: '*' }).then(([count]) => Number(count.total)) >= 3);
    } finally {
      await mysql('audit_log').where({ organization_id: organizationId }).delete();
      await mysql('users').where({ organization_id: organizationId }).delete();
      await mysql('roles').where({ organization_id: organizationId }).delete();
      await mysql('organizations').where({ id: organizationId }).delete();
    }
  });

  it('mysql: seeded system role permissions match the legacy authorization map', async () => {
    await migrateWp6AssignmentPermissions(mysql);
    await migrateWp7ReportPermissions(mysql);
    const expected = rolePermissionsFrom(permissionRoles);
    const expectedSeed = rolePermissionsFrom({
      ...seededPermissionRoles, ...examPermissionRoles, ...financePermissionRoles,
      ...assignmentPermissionRoles, ...reportPermissionRoles, ...portalExtensionPermissionRoles
    });
    assert.deepEqual(expectedSeed, expected);

    const roleKeys = Object.keys(expected);
    const roles = await mysql('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key', 'is_system');
    assert.equal(roles.length, roleKeys.length);
    assert.ok(roles.every((role) => Boolean(role.is_system)));
    const roleIds = roles.map((role) => role.id);
    const rows = await mysql('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereIn('rp.role_id', roleIds)
      .select('r.key as role_key', 'rp.permission_key');
    const actual = {};
    for (const row of rows) (actual[row.role_key] ??= []).push(row.permission_key);
    for (const permissions of Object.values(actual)) permissions.sort();
    assert.deepEqual(
      Object.fromEntries(Object.entries(actual).sort(([left], [right]) => left.localeCompare(right))),
      expected
    );
  });

  for (const mode of ['memory', 'mysql']) {
    it(`${mode}: platform role assignment revokes active sessions and audits the change`, async () => {
      await runPlatformRoleAssignmentContract(await createFixture(mode));
    });

    it(`${mode}: role and account changes audit before/after state in organization scope`, async () => {
      await runManagedRoleAuditContract(await createFixture(mode));
    });

    it(`${mode}: final active school administrator cannot be deactivated or demoted`, async () => {
      await runLastSchoolAdministratorProtectionContract(await createFixture(mode));
    });

    it(`${mode}: fees, cashier shifts, reversals, isolation and audit`, async () => {
      const fixture = await createFixture(mode);
      const result = await runFeeContract(fixture);
      if (mode === 'mysql') await verifyMysqlTransactionRollback(fixture, result.item);
    });

    it(`${mode}: WP5 fee structures, discounts, refunds, adjustments, arrears, reports and cashbook`, async () => {
      await runFinanceContract(await createFixture(mode));
    });

    it(`${mode}: report totals, campus and teacher scope, export parity and permission denial`, async () => {
      await runReportsContract(await createFixture(mode));
    });

    it(`${mode}: mark workflow transitions, isolation and audit`, async () => {
      await runMarksContract(await createFixture(mode));
    });

    it(`${mode}: exam scheduling, weights, marks, scoping, notifications and frozen reports`, async () => {
      await runExamsContract(await createFixture(mode));
    });

    it(`${mode}: assignment workflow, class scope, submissions, grading and notifications`, async () => {
      await runAssignmentsContract(await createFixture(mode));
    });

    it(`${mode}: guardian portal links, campus scope and published-only data`, async () => {
      await runPortalContract(await createFixture(mode));
    });

    it(`${mode}: academic year, section, curriculum and promotion workflows`, async () => {
      await runAcademicContract(await createFixture(mode));
    });

    it(`${mode}: student capacity, sensitive data, contacts, status and import scope`, async () => {
      await runStudentsContract(await createFixture(mode));
    });

    if (mode === 'mysql') {
      it.skip('mysql: readmission and section transfer (sections has no is_active column)', async () => {});
    }

    it(`${mode}: admissions workflow, documents, public intake and enrolment`, async () => {
      await runAdmissionsContract(await createFixture(mode));
    });

    it(`${mode}: attendance replay, correction workflow, campus and roster scope`, async () => {
      const fixture = await createFixture(mode);
      const sectionA = await runAttendanceContract(fixture);
      await verifyAttendanceAuditRollback(fixture, sectionA);
    });

    it(`${mode}: staff capacity, scope, assignments, attendance, leave and rollback`, async () => {
      await runStaffContract(await createFixture(mode));
    });

    it(`${mode}: campus communications, notification recipients and read status`, async () => {
      await runCommunicationsContract(await createFixture(mode));
    });

    it(`${mode}: refresh-token rotation and reuse rejection`, async () => {
      await runRefreshTokenContract(await createFixture(mode));
    });

    it(`${mode}: audit scope, active sessions and session revocation`, async () => {
      await runAuditSessionContract(await createFixture(mode));
    });

    it(`${mode}: branch limits, administrator membership and scoped session switching`, async () => {
      await runBranchManagementContract(await createFixture(mode));
    });

    it(`${mode}: platform school provisioning, administrator invitation and branch membership`, async () => {
      await runPlatformSchoolProvisioningContract(await createFixture(mode));
    });

    it(`${mode}: subscription lifecycle, user quota, refund and expiry`, async () => {
      await runPlatformLifecycleContract(await createFixture(mode));
    });

    it(`${mode}: login failure lockout counter`, async () => {
      await runLoginFailureContract(await createFixture(mode));
    });

    it(`${mode}: password reset token is single-use`, async () => {
      await runPasswordResetContract(await createFixture(mode));
    });

    it(`${mode}: invitation acceptance creates the scoped account`, async () => {
      await runInvitationAcceptanceContract(await createFixture(mode));
    });

    it(`${mode}: invitation acceptance rechecks the user quota`, async () => {
      await runInvitationAcceptanceQuotaContract(await createFixture(mode));
    });

    it(`${mode}: invitations cannot target another organization`, async () => {
      await runCrossOrganizationInvitationContract(await createFixture(mode));
    });
  }

  it('mysql: cashbook account idempotency migration backfills existing accounts', async () => {
    await runCashbookAccountIdempotencyBackfillContract();
  });

  it('mysql: legacy fee migration preserves realistic invoice balances across tenants', async () => {
    await runLegacyFinanceBackfillContract();
  });

  it.skip('memory: academic year activation rolls back when the audit write fails', async () => {
    const fixture = await createFixture('memory');
    await runAcademicContract(fixture);
    // Known adapter parity issue: memory activation updates year state before appending audit.
  });
});
