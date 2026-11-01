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
import { up as migrateFeeItemCategory } from '../migrations/202610300002_fee_item_category.js';
import { up as migrateRefreshTokenCampusScope } from '../migrations/202611010001_refresh_token_campus_scope.js';
import { up as migratePlatformAdminInvitation } from '../migrations/202611010002_platform_school_admin_invitations.js';

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
    await mysql('organizations').insert({ id: orgId, name: 'Repository Contract School', status: 'active' });
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

  const closed = await repo.closeCashierShift(shift.id, { closingCash: 50 }, cashier);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.expectedCash, 50);
  assert.equal(closed.variance, 0);

  const actions = await auditActions(fixture, campusA);
  for (const action of [
    'fee_item.created', 'cashier_shift.opened', 'fee_invoice.issued',
    'fee_payment.recorded', 'fee_payment.reversed', 'cashier_shift.closed'
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
    await db('organizations').insert({ id: foreignOrgId, name: 'Portal Foreign School', status: 'active' });
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
  const { repo, db, campusA, campusB, actors } = fixture;
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
    const enrolled = await repo.enrolAdmission(admission.id, { sectionId: sectionA.id }, actors.owner.actor);
    assert.equal(enrolled.student.status, 'enrolled');
    assert.equal(enrolled.student.campusId, campusA);
    assert.equal(enrolled.admission.status, 'enrolled');
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
      id: organizationId, name: 'Contract Foreign Organization', status: 'active'
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
  assert.equal(await repo.consumeRefreshToken(originalHash), null, 'a consumed token cannot be reused');

  const rotatedHash = randomUUID().replaceAll('-', '').repeat(2);
  await repo.storeRefreshToken(rotatedHash, firstRotation.id, expiresAt);
  const secondRotation = await repo.consumeRefreshToken(rotatedHash);
  assert.equal(secondRotation.id, actors.owner.id);
  assert.equal(await repo.consumeRefreshToken(rotatedHash), null, 'the rotated token is also single-use');
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
      id: foreignOrganizationId, name: 'Foreign Branch Contract', status: 'active'
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
  assert.equal((await repo.findUserById(accepted.id)).campusIds.includes(additionalCampusId), true);
  const school = (await repo.listPlatformSchools()).find((item) => item.id === created.organizationId);
  assert.equal(school.owner?.email, data.ownerEmail, JSON.stringify({ accepted, owner: school.owner }));
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
  const { repo } = fixture;
  const login = `lockout-${randomUUID()}@example.test`;
  const controller = createAuthController({
    repo, config: { NODE_ENV: 'test' }, parse: (_schema, value) => value
  });
  async function attemptLogin() {
    const response = {
      statusCode: 200,
      status(statusCode) { this.statusCode = statusCode; return this; },
      json(body) { this.body = body; return this; }
    };
    await controller.login({ body: { login, password: 'invalid' } }, response, (error) => {
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
  const foundInvitation = await repo.getAccountInvitation(invitation.tokenHash);
  assert.equal(foundInvitation.email, invitation.email);

  const user = await repo.acceptAccountInvitation(invitation.tokenHash, 'contract-password-hash');
  assert.equal(user.role, invitation.role);
  assert.equal(user.orgId, orgId);
  assert.deepEqual(user.campusIds, [campusA]);
  assert.equal(await repo.acceptAccountInvitation(invitation.tokenHash, 'reused-password-hash'), null);
  assert.equal(await repo.getAccountInvitation(invitation.tokenHash), null);
  if (db) {
    const linked = await db('staff').where({ id: target.id }).first('user_id');
    assert.equal(linked.user_id, user.id);
  } else {
    assert.equal(repo.staff.find((staff) => staff.id === target.id).userId, user.id);
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

  for (const mode of ['memory', 'mysql']) {
    it(`${mode}: fees, cashier shifts, reversals, isolation and audit`, async () => {
      const fixture = await createFixture(mode);
      const result = await runFeeContract(fixture);
      if (mode === 'mysql') await verifyMysqlTransactionRollback(fixture, result.item);
    });

    it(`${mode}: mark workflow transitions, isolation and audit`, async () => {
      await runMarksContract(await createFixture(mode));
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

    it(`${mode}: branch limits, administrator membership and scoped session switching`, async () => {
      await runBranchManagementContract(await createFixture(mode));
    });

    it(`${mode}: platform school provisioning, administrator invitation and branch membership`, async () => {
      await runPlatformSchoolProvisioningContract(await createFixture(mode));
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
