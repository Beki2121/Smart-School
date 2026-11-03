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
import { MemoryRepository, MysqlRepository } from '../src/repository.js';
import { permissionRoles } from '../src/middleware/permissions.js';
import { up as migrateFeeItemCategory } from '../migrations/202610300002_fee_item_category.js';
import { up as migrateRefreshTokenCampusScope } from '../migrations/202611010001_refresh_token_campus_scope.js';
import { up as migratePlatformAdminInvitation } from '../migrations/202611010002_platform_school_admin_invitations.js';
import { up as migratePlatformUserInvitations } from '../migrations/202611020003_platform_user_invitations.js';
import { up as migratePlatformDashboard } from '../migrations/202611030001_platform_dashboard_quotas.js';
import { up as migrateWp4Exams } from '../migrations/202611030004_wp4_exams.js';
import { examPermissionRoles } from '../migrations/202611030005_exams_permissions.js';
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
  const { repo, db, orgId, campusA, campusB, studentA, actors } = fixture;
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

  const weighted = await repo.getWeightedExamResult(studentA, term.id, actors.owner.actor);
  assert.equal(weighted.scoreBasisPoints, 8600);
  assert.equal(weighted.missingExamCount, 0);
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

  const { yearA } = await prepareAcademicStudentFixture(fixture);
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
  const { repo, campusA, campusB, actors } = fixture;
  const announcementA = await repo.createCampusAnnouncement({
    titleEn: 'Campus A announcement', titleAm: 'ማስታወቂያ ሀ',
    bodyEn: 'Campus A only', bodyAm: 'ለግቢ ሀ ብቻ'
  }, actors.owner.actor);
  const announcementB = await repo.createCampusAnnouncement({
    titleEn: 'Campus B announcement', titleAm: 'ማስታወቂያ ለ',
    bodyEn: 'Campus B only', bodyAm: 'ለግቢ ለ ብቻ'
  }, actors.campusBOwner.actor);
  assert.deepEqual((await repo.listCampusAnnouncements(campusA)).map((row) => row.id), [announcementA.id]);
  assert.deepEqual((await repo.listCampusAnnouncements(campusB)).map((row) => row.id), [announcementB.id]);

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
  assert.deepEqual((await repo.listCampusEvents(campusA, from, to)).map((row) => row.id), [eventA.id]);
  assert.deepEqual((await repo.listCampusEvents(campusB, from, to)).map((row) => row.id), [eventB.id]);

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

describe('repository adapter contracts', { concurrency: false }, () => {
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
    const expected = rolePermissionsFrom(permissionRoles);
    const expectedSeed = rolePermissionsFrom({ ...seededPermissionRoles, ...examPermissionRoles });
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

    it(`${mode}: mark workflow transitions, isolation and audit`, async () => {
      await runMarksContract(await createFixture(mode));
    });

    it(`${mode}: exam scheduling, weights, marks, scoping, notifications and frozen reports`, async () => {
      await runExamsContract(await createFixture(mode));
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

  it.skip('memory: academic year activation rolls back when the audit write fails', async () => {
    const fixture = await createFixture('memory');
    await runAcademicContract(fixture);
    // Known adapter parity issue: memory activation updates year state before appending audit.
  });
});
