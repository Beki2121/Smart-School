import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import knexFactory from 'knex';
import { after, before, describe, it } from 'node:test';
import { createAuthController } from '../src/controllers/auth.controller.js';
import { MemoryRepository, MysqlRepository } from '../src/repository.js';
import { up as migrateFeeItemCategory } from '../migrations/202610300002_fee_item_category.js';

const testEnvPath = fileURLToPath(new URL('../../.env.mysql-test', import.meta.url));
if (!existsSync(testEnvPath)) {
  throw new Error('Missing repository-root .env.mysql-test configuration for MySQL contract tests.');
}
dotenv.config({ path: testEnvPath, override: true });

const databaseName = process.env.DB_NAME;
if (!databaseName?.endsWith('_test')) {
  throw new Error('Repository contract tests require DB_NAME to end in "_test".');
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
  assert.equal((await repo.getAccountInvitation(invitation.tokenHash)).email, invitation.email);

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
  it('fee-item category migration safely defaults existing rows and is idempotent', async () => {
    await runFeeItemCategoryMigrationContract();
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
});
