import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import knexFactory from 'knex';
import { after, before, describe, it } from 'node:test';
import { MemoryRepository, MysqlRepository } from '../src/repository.js';

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
    ['campusBOwner', 'owner_director', campusB]
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
      password_hash: 'contract-test-not-a-login-hash', role: user.role, is_active: true
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

describe('repository adapter contracts', { concurrency: false }, () => {
  for (const mode of ['memory', 'mysql']) {
    it(`${mode}: fees, cashier shifts, reversals, isolation and audit`, async () => {
      const fixture = await createFixture(mode);
      const result = await runFeeContract(fixture);
      if (mode === 'mysql') await verifyMysqlTransactionRollback(fixture, result.item);
    });

    it(`${mode}: mark workflow transitions, isolation and audit`, async () => {
      await runMarksContract(await createFixture(mode));
    });
  }
});
