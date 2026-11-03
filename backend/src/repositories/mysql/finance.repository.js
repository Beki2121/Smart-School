import { randomUUID } from 'node:crypto';
import {
  addisDate, auditRow, campusScopeError, feeConflict, now, setupConflict
} from '../shared.js';
import { feeBalanceFromLedger, moneyCents, roundMoney } from '../fees.mappers.js';
import { reportTooLarge } from '../../reports/aggregate.js';

const MAX_FINANCE_REPORT_ROWS = 10000;
const minor = (value) => Number(value ?? 0);
const dateOnly = (value) => value == null ? null : value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : String(value).slice(0, 10);
const amount = (value) => roundMoney(minor(value) / 100);

async function boundedFinanceReportRows(query) {
  const rows = await query.limit(MAX_FINANCE_REPORT_ROWS + 1);
  if (rows.length > MAX_FINANCE_REPORT_ROWS) throw reportTooLarge();
  return rows;
}

function mapScoped(row, fields) {
  const result = { id: row.id, organizationId: row.organization_id, campusId: row.campus_id };
  for (const [target, source] of Object.entries(fields)) {
    result[target] = typeof source === 'function' ? source(row) : row[source];
  }
  return result;
}

function mapFeeStructure(row) {
  return {
    ...mapScoped(row, {
      academicYearId: 'academic_year_id', gradeLevelId: 'grade_level_id', name: 'name',
      currencyCode: 'currency_code', status: 'status', createdBy: 'created_by',
      createdAt: (item) => item.created_at instanceof Date
        ? item.created_at.toISOString() : item.created_at
    })
  };
}

function mapInstallment(row) {
  return {
    ...mapScoped(row, {
      structureId: 'structure_id', installmentNumber: 'installment_number',
      dueDate: (item) => dateOnly(item.due_date), amountMinor: (item) => minor(item.amount_minor)
    })
  };
}

function mapRequest(row, keys) {
  const result = mapScoped(row, keys);
  for (const field of ['createdAt', 'updatedAt']) {
    const column = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (result[field] instanceof Date) result[field] = result[field].toISOString();
    else if (row[column] instanceof Date) result[field] = row[column].toISOString();
  }
  return result;
}

async function insertNotification(trx, actor, userId, sourceType, sourceId, title, body) {
  await trx('user_notifications').insert({
    id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
    user_id: userId, source_type: sourceType, source_id: sourceId,
    title_en: title, title_am: title, body_en: body, body_am: body
  }).onConflict(['user_id', 'source_type', 'source_id']).ignore();
}

async function loadInvoiceBalance(trx, invoice) {
  const [payments, adjustments] = await Promise.all([
    trx('fee_payments').where({
      organization_id: invoice.organization_id, campus_id: invoice.campus_id,
      invoice_id: invoice.id
    }).select('entry_type', 'amount'),
    trx('fee_adjustments').where({
      organization_id: invoice.organization_id, campus_id: invoice.campus_id,
      invoice_id: invoice.id
    }).select('adjustment_type', 'amount_minor')
  ]);
  return feeBalanceFromLedger(Number(invoice.total_amount), [
    ...payments,
    ...adjustments.map((entry) => ({
      adjustment_type: entry.adjustment_type, amount_minor: minor(entry.amount_minor)
    }))
  ]);
}

function statusFromBalance(invoice, balance) {
  const cents = moneyCents(balance);
  if (cents === 0) return 'paid';
  return cents === moneyCents(Number(invoice.total_amount)) ? 'issued' : 'partially_paid';
}

async function principalForCampus(trx, actor) {
  return trx('users').where({
    organization_id: actor.orgId, is_active: true
  }).where('role', 'principal')
    .whereExists(function existsCampus() {
      this.select(trx.raw('1')).from('user_campuses as uc')
        .whereRaw('uc.user_id = users.id').andWhere('uc.campus_id', actor.activeCampusId)
        .andWhere('uc.is_active', true);
    }).first('id');
}

async function notifyRequester(trx, actor, request, sourceType, title) {
  await insertNotification(trx, actor, request.requested_by, sourceType, request.id, title, request.status);
}

export const mysqlFinanceBundle = {
  async listFeeStructures(actor) {
    const rows = await this.db('fee_structures').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return Promise.all(rows.map(async (row) => ({
      ...mapFeeStructure(row),
      installments: (await this.db('fee_structure_installments').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, structure_id: row.id
      }).orderBy('installment_number')).map(mapInstallment)
    })));
  },
  async createFeeStructure(data, actor) {
    const id = randomUUID();
    const installments = data.installments.map((entry, index) => ({
      id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
      structure_id: id, installment_number: index + 1, due_date: entry.dueDate,
      amount_minor: entry.amountMinor
    }));
    if (!installments.length || installments.some((item) => item.amount_minor <= 0)) {
      throw setupConflict('A fee structure needs positive installments.');
    }
    const structure = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
      academic_year_id: data.academicYearId, grade_level_id: data.gradeLevelId,
      name: data.name, currency_code: data.currencyCode, status: 'active', created_by: actor.sub
    };
    await this.db.transaction(async (trx) => {
      const [year, grade] = await Promise.all([
        trx('academic_years').where({
          id: data.academicYearId, campus_id: actor.activeCampusId
        }).first('id'),
        trx('grade_levels').where({
          id: data.gradeLevelId, campus_id: actor.activeCampusId
        }).first('id')
      ]);
      if (!year || !grade) throw campusScopeError('Fee structure context is outside the active campus.');
      const duplicate = await trx('fee_structures').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        academic_year_id: year.id, grade_level_id: grade.id, name: data.name
      }).whereNot('status', 'archived').first('id');
      if (duplicate) throw setupConflict('An active fee structure with this name already exists for the grade and year.');
      await trx('fee_structures').insert(structure);
      await trx('fee_structure_installments').insert(installments);
      await trx('audit_log').insert(auditRow(actor, 'fee_structure.created', 'fee_structure', id, null, {
        ...data, id, installments
      }));
    });
    return {
      ...mapFeeStructure(structure),
      installments: installments.map(mapInstallment)
    };
  },
  async previewFeeStructureInvoices(structureId, sectionId, actor) {
    const structure = await this.db('fee_structures').where({
      id: structureId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    if (!structure) return null;
    let sections = this.db('sections').where({
      campus_id: actor.activeCampusId, grade_level_id: structure.grade_level_id,
      academic_year_id: structure.academic_year_id
    });
    if (sectionId) sections = sections.andWhere({ id: sectionId });
    const sectionRows = await sections.select('id', 'name');
    if (sectionId && !sectionRows.length) {
      throw campusScopeError('Selected section is outside the fee structure grade and year.');
    }
    const sectionIds = sectionRows.map((row) => row.id);
    const students = sectionIds.length ? await this.db('enrolments as e')
      .join('students as s', 's.id', 'e.student_id')
      .where({
        'e.academic_year_id': structure.academic_year_id, 'e.status': 'active',
        's.campus_id': actor.activeCampusId
      }).whereNull('s.archived_at').whereIn('e.section_id', sectionIds)
      .select('s.id', 's.student_no', 's.given_name_en', 's.father_name_en') : [];
    const [installments, existing] = await Promise.all([
      this.db('fee_structure_installments').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, structure_id: structureId
      }).orderBy('installment_number'),
      this.db('fee_structure_invoices').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, structure_id: structureId
      }).select('student_id', 'installment_id')
    ]);
    const keys = new Set(existing.map((item) => `${item.student_id}:${item.installment_id}`));
    const skipped = new Set(students.filter((student) =>
      installments.some((installment) => keys.has(`${student.id}:${installment.id}`)))
      .map((student) => student.id));
    return {
      structureId, sectionId: sectionId ?? null, currencyCode: structure.currency_code,
      studentCount: students.length, installments: installments.map(mapInstallment),
      eligibleStudents: students.map((student) => ({
        studentId: student.id, studentNo: student.student_no,
        studentName: `${student.given_name_en} ${student.father_name_en}`
      })),
      skippedStudents: [...skipped]
    };
  },
  async generateFeeStructureInvoices(structureId, sectionId, idempotencyKey, actor) {
    return this.db.transaction(async (trx) => {
      const structure = await trx('fee_structures').where({
        id: structureId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!structure) return null;
      const prior = await trx('fee_invoice_generations').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        structure_id: structureId, idempotency_key: idempotencyKey
      }).first();
      if (prior) {
        const links = await trx('fee_structure_invoices').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          generation_id: prior.id
        }).select('invoice_id');
        const invoiceIds = new Set(links.map((item) => item.invoice_id));
        const invoices = await this.listFeeInvoices(actor);
        return {
          generationId: prior.id, invoiceCount: prior.invoice_count, duplicate: true,
          invoices: invoices.filter((invoice) => invoiceIds.has(invoice.id))
        };
      }
      const preview = await this.previewFeeStructureInvoices(structureId, sectionId, actor);
      const batchId = randomUUID();
      await trx('fee_invoice_generations').insert({
        id: batchId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        structure_id: structureId, idempotency_key: idempotencyKey,
        target_section_id: sectionId ?? null, invoice_count: 0
      });
      const skipped = new Set(preview.skippedStudents);
      const invoiceRows = [];
      for (const student of preview.eligibleStudents) {
        if (skipped.has(student.studentId)) continue;
        for (const installment of preview.installments) {
          const exists = await trx('fee_structure_invoices').where({
            organization_id: actor.orgId, campus_id: actor.activeCampusId,
            structure_id: structureId, installment_id: installment.id, student_id: student.studentId
          }).forUpdate().first('id');
          if (exists) continue;
          const invoiceId = randomUUID();
          const invoiceNumber = `INV-${invoiceId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
          const totalAmount = amount(installment.amountMinor);
          await trx('invoices').insert({
            id: invoiceId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            student_id: student.studentId, invoice_number: invoiceNumber,
            currency_code: structure.currency_code, total_amount: totalAmount,
            due_date: installment.dueDate, status: 'issued', issued_by: actor.sub
          });
          await trx('invoice_lines').insert({
            id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
            invoice_id: invoiceId, fee_item_id: null,
            description_en: `${structure.name} - installment ${installment.installmentNumber}`,
            description_am: `${structure.name} - installment ${installment.installmentNumber}`,
            unit_amount: totalAmount, quantity: 1, line_total: totalAmount
          });
          await trx('fee_structure_invoices').insert({
            id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
            structure_id: structureId, generation_id: batchId, installment_id: installment.id,
            student_id: student.studentId, invoice_id: invoiceId
          });
          invoiceRows.push({
            id: invoiceId, invoiceNumber, studentId: student.studentId,
            totalAmount, dueDate: installment.dueDate
          });
        }
      }
      await trx('fee_invoice_generations').where({ id: batchId }).update({ invoice_count: invoiceRows.length });
      await trx('audit_log').insert(auditRow(actor, 'fee_invoice.bulk_generated',
        'fee_invoice_generation', batchId, null, {
          structureId, sectionId: sectionId ?? null, invoiceCount: invoiceRows.length, invoices: invoiceRows
        }));
      return { generationId: batchId, invoiceCount: invoiceRows.length, invoices: invoiceRows, duplicate: false };
    });
  },
  async listFeeDiscountTypes(actor) {
    const rows = await this.db('fee_discount_types').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('code');
    return rows.map((row) => mapScoped(row, {
      code: row.code, name: row.name, category: row.category,
      discountKind: row.discount_kind, isActive: Boolean(row.is_active)
    }));
  },
  async createFeeDiscountType(data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      await trx('fee_discount_types').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        code: data.code, name: data.name, category: data.category,
        discount_kind: data.discountKind, is_active: true
      });
      await trx('audit_log').insert(auditRow(actor, 'fee_discount_type.created',
        'fee_discount_type', id, null, data));
    });
    return { id, organizationId: actor.orgId, campusId: actor.activeCampusId, ...data, isActive: true };
  },
  async listFeeDiscountRequests(actor) {
    const rows = await this.db('fee_discount_requests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return rows.map((row) => mapRequest(row, {
      studentId: 'student_id', discountTypeId: 'discount_type_id',
      academicYearId: 'academic_year_id', periodKey: 'period_key',
      percentageBasisPoints: 'percentage_basis_points', fixedAmountMinor: 'fixed_amount_minor',
      reason: 'reason',       status: 'status', expiresOn: (item) => dateOnly(item.expires_on),
      requestedBy: 'requested_by', approvedBy: 'approved_by',
      idempotencyKey: 'idempotency_key',       createdAt: (item) => item.created_at, updatedAt: (item) => item.updated_at
    }));
  },
  async requestFeeDiscount(data, actor) {
    const prior = await this.db('fee_discount_requests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId,
      idempotency_key: data.idempotencyKey
    }).first();
    if (prior) return { id: prior.id, status: prior.status, duplicate: true };
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      const [student, type] = await Promise.all([
        trx('students as s').join('campuses as c', 'c.id', 's.campus_id').where({
          's.id': data.studentId, 's.campus_id': actor.activeCampusId,
          'c.organization_id': actor.orgId
        }).whereNull('s.archived_at').first('s.id'),
        trx('fee_discount_types').where({
          id: data.discountTypeId, organization_id: actor.orgId,
          campus_id: actor.activeCampusId, is_active: true
        }).first()
      ]);
      if (!student || !type) throw campusScopeError('Student or discount type is outside the active campus.');
      if ((type.discount_kind === 'percentage' && (!data.percentageBasisPoints ||
          data.percentageBasisPoints > 10000)) ||
          (type.discount_kind === 'fixed' && (!data.fixedAmountMinor || data.fixedAmountMinor <= 0))) {
        throw setupConflict('Discount value does not match the discount type.');
      }
      const row = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        student_id: data.studentId, discount_type_id: data.discountTypeId,
        academic_year_id: data.academicYearId ?? null, period_key: data.periodKey,
        percentage_basis_points: data.percentageBasisPoints ?? null,
        fixed_amount_minor: data.fixedAmountMinor ?? null, reason: data.reason,
        expires_on: data.expiresOn ?? null, requested_by: actor.sub, status: 'pending',
        idempotency_key: data.idempotencyKey
      };
      await trx('fee_discount_requests').insert(row)
        .onConflict(['organization_id', 'campus_id', 'idempotency_key']).ignore();
      const savedRequest = await trx('fee_discount_requests').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (!savedRequest) throw setupConflict('Discount request was not persisted.');
      if (savedRequest.id !== id) {
        return { id: savedRequest.id, status: savedRequest.status, duplicate: true };
      }
      await trx('audit_log').insert(auditRow(actor, 'fee_discount.requested',
        'fee_discount_request', id, null, data));
      const principal = await principalForCampus(trx, actor);
      if (principal) await insertNotification(trx, actor, principal.id,
        'fee_discount_request', id, 'Discount approval requested', data.reason);
    });
    return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
      ...data, status: 'pending', requestedBy: actor.sub };
  },
  async transitionFeeDiscount(requestId, targetStatus, actor) {
    return this.db.transaction(async (trx) => {
      const request = await trx('fee_discount_requests').where({
        id: requestId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!request) return null;
      if (targetStatus === 'approved' && request.requested_by === actor.sub) {
        throw setupConflict('A requester cannot approve their own discount.');
      }
      if (request.status === targetStatus) return { id: request.id, status: request.status };
      if (request.status !== 'pending' || !['approved', 'rejected', 'cancelled'].includes(targetStatus)) {
        throw setupConflict('Discount request has an invalid state transition.');
      }
      if (targetStatus === 'approved' && request.expires_on && dateOnly(request.expires_on) < addisDate()) {
        throw setupConflict('Expired discounts cannot be approved.');
      }
      const before = { status: request.status };
      const applications = [];
      if (targetStatus === 'approved') {
        const invoices = await trx('invoices').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          student_id: request.student_id
        }).whereNotIn('status', ['paid', 'void']).forUpdate();
        let fixedRemaining = minor(request.fixed_amount_minor);
        for (const invoice of invoices) {
          if (request.period_key && !String(dateOnly(invoice.due_date) ?? '').startsWith(request.period_key)) continue;
          const balance = await loadInvoiceBalance(trx, invoice);
          const balanceMinor = moneyCents(balance);
          if (balanceMinor <= 0) continue;
          const discount = request.percentage_basis_points != null
            ? Math.floor((balanceMinor * request.percentage_basis_points + 5000) / 10000)
            : Math.min(balanceMinor, fixedRemaining);
          if (discount <= 0) continue;
          fixedRemaining -= discount;
          const applicationId = randomUUID();
          await trx('fee_discount_applications').insert({
            id: applicationId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
            discount_request_id: request.id, invoice_id: invoice.id, amount_minor: discount
          });
          await trx('fee_adjustments').insert({
            id: randomUUID(), organization_id: actor.orgId, campus_id: actor.activeCampusId,
            invoice_id: invoice.id, discount_application_id: applicationId,
            adjustment_type: 'credit', amount_minor: discount, reason: request.reason,
            created_by: actor.sub
          });
          const nextBalance = await loadInvoiceBalance(trx, invoice);
          await trx('invoices').where({
            id: invoice.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
          }).update({ status: statusFromBalance(invoice, nextBalance) });
          applications.push({ invoiceId: invoice.id, amountMinor: discount });
        }
      }
      await trx('fee_discount_requests').where({ id: requestId }).update({
        status: targetStatus, approved_by: targetStatus === 'approved' ? actor.sub : null,
        updated_at: trx.fn.now()
      });
      await trx('audit_log').insert(auditRow(actor, `fee_discount.${targetStatus}`,
        'fee_discount_request', requestId, before, {
          status: targetStatus, approvedBy: targetStatus === 'approved' ? actor.sub : null,
          applications
        }));
      await notifyRequester(trx, actor, { ...request, status: targetStatus },
        'fee_discount_status', 'Discount request updated');
      return { id: requestId, status: targetStatus, applications };
    });
  },
  async listFeeRefundRequests(actor) {
    const rows = await this.db('fee_refund_requests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return rows.map((row) => mapRequest(row, {
      paymentId: 'payment_id', amountMinor: (item) => minor(item.amount_minor),
      reason: 'reason', status: 'status', requestedBy: 'requested_by',
      approvedBy: 'approved_by', idempotencyKey: 'idempotency_key',
      refundPaymentId: 'refund_payment_id', createdAt: (item) => item.created_at,
      updatedAt: (item) => item.updated_at
    }));
  },
  async requestFeeRefund(data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const payment = await trx('fee_payments').where({
        id: data.paymentId, organization_id: actor.orgId,
        campus_id: actor.activeCampusId, entry_type: 'payment'
      }).forUpdate().first();
      if (!payment) throw campusScopeError('Payment is outside the active campus.');
      const prior = await trx('fee_refund_requests').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).forUpdate().first();
      if (prior) return { id: prior.id, status: prior.status, duplicate: true };
      const [approved, pending, reversed] = await Promise.all([
        trx('fee_refund_requests').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          payment_id: payment.id, status: 'approved'
        }).sum({ total: 'amount_minor' }).first(),
        trx('fee_refund_requests').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          payment_id: payment.id, status: 'pending'
        }).sum({ total: 'amount_minor' }).first(),
        trx('fee_payments').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          reverses_payment_id: payment.id, entry_type: 'reversal'
        }).sum({ total: 'amount' }).first()
      ]);
      const available = moneyCents(Number(payment.amount)) -
        minor(approved.total) - minor(pending.total) - moneyCents(Number(reversed.total ?? 0));
      if (data.amountMinor <= 0 || data.amountMinor > available) {
        throw feeConflict('Refund requests exceed the remaining refundable payment amount.');
      }
      const request = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        payment_id: payment.id, amount_minor: data.amountMinor, reason: data.reason,
        status: 'pending', requested_by: actor.sub, idempotency_key: data.idempotencyKey
      };
      await trx('fee_refund_requests').insert(request)
        .onConflict(['organization_id', 'campus_id', 'idempotency_key']).ignore();
      const savedRequest = await trx('fee_refund_requests').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (!savedRequest) throw setupConflict('Refund request was not persisted.');
      if (savedRequest.id !== id) {
        return { id: savedRequest.id, status: savedRequest.status, duplicate: true };
      }
      await trx('audit_log').insert(auditRow(actor, 'fee_refund.requested',
        'fee_refund_request', id, null, data));
      const principal = await principalForCampus(trx, actor);
      if (principal) await insertNotification(trx, actor, principal.id,
        'fee_refund_request', id, 'Refund approval requested', data.reason);
      return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        ...data, status: 'pending', requestedBy: actor.sub };
    });
  },
  async transitionFeeRefund(requestId, targetStatus, actor) {
    return this.db.transaction(async (trx) => {
      const request = await trx('fee_refund_requests').where({
        id: requestId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!request) return null;
      if (targetStatus === 'approved' && request.requested_by === actor.sub) {
        throw setupConflict('A requester cannot approve their own refund.');
      }
      if (request.status === targetStatus) return { id: request.id, status: request.status };
      if (request.status !== 'pending' || !['approved', 'rejected'].includes(targetStatus)) {
        throw setupConflict('Refund request has an invalid state transition.');
      }
      const payment = await trx('fee_payments').where({
        id: request.payment_id, organization_id: actor.orgId,
        campus_id: actor.activeCampusId, entry_type: 'payment'
      }).forUpdate().first();
      if (!payment) throw campusScopeError('Payment is outside the active campus.');
      const invoice = await trx('invoices').where({
        id: payment.invoice_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!invoice) throw campusScopeError('Invoice is outside the active campus.');
      const beforeBalance = await loadInvoiceBalance(trx, invoice);
      let reversalId = null;
      if (targetStatus === 'approved') {
        const [approved, reversed] = await Promise.all([
          trx('fee_refund_requests').where({
            organization_id: actor.orgId, campus_id: actor.activeCampusId,
            payment_id: payment.id, status: 'approved'
          }).sum({ total: 'amount_minor' }).first(),
          trx('fee_payments').where({
            organization_id: actor.orgId, campus_id: actor.activeCampusId,
            reverses_payment_id: payment.id, entry_type: 'reversal'
          }).sum({ total: 'amount' }).first()
        ]);
        if (request.amount_minor > moneyCents(Number(payment.amount)) -
            minor(approved.total) - moneyCents(Number(reversed.total ?? 0))) {
          throw feeConflict('Refund exceeds the remaining refundable payment amount.');
        }
        reversalId = randomUUID();
        await trx('fee_payments').insert({
          id: reversalId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          invoice_id: invoice.id, entry_type: 'reversal', reverses_payment_id: payment.id,
          amount: amount(request.amount_minor), method: payment.method, reason: request.reason,
          recorded_by: actor.sub, recorded_on: addisDate()
        });
      }
      await trx('fee_refund_requests').where({ id: request.id }).update({
        status: targetStatus, approved_by: targetStatus === 'approved' ? actor.sub : null,
        refund_payment_id: reversalId, updated_at: trx.fn.now()
      });
      const afterBalance = await loadInvoiceBalance(trx, invoice);
      if (afterBalance < 0) throw feeConflict('Refund would create a negative invoice balance.');
      await trx('invoices').where({
        id: invoice.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: statusFromBalance(invoice, afterBalance) });
      await trx('audit_log').insert(auditRow(actor, `fee_refund.${targetStatus}`,
        'fee_refund_request', requestId, { status: request.status, invoiceBalance: beforeBalance }, {
          status: targetStatus, approvedBy: targetStatus === 'approved' ? actor.sub : null,
          refundPaymentId: reversalId, invoiceBalance: afterBalance
        }));
      await notifyRequester(trx, actor, { ...request, status: targetStatus },
        'fee_refund_status', 'Refund request updated');
      return { id: requestId, status: targetStatus, refundPaymentId: reversalId };
    });
  },
  async requestFeeAdjustment(data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const prior = await trx('fee_adjustment_requests').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (prior) return { id: prior.id, status: prior.status, duplicate: true };
      const invoice = await trx('invoices').where({
        id: data.invoiceId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).first('id', 'status');
      if (!invoice || invoice.status === 'void') throw campusScopeError('Invoice is outside the active campus.');
      if (data.amountMinor <= 0) throw feeConflict('Adjustment amount must be positive.');
      await trx('fee_adjustment_requests').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        invoice_id: invoice.id, adjustment_type: data.adjustmentType,
        amount_minor: data.amountMinor, reason: data.reason,
        status: 'pending', requested_by: actor.sub, idempotency_key: data.idempotencyKey
      }).onConflict(['organization_id', 'campus_id', 'idempotency_key']).ignore();
      const savedRequest = await trx('fee_adjustment_requests').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (!savedRequest) throw setupConflict('Adjustment request was not persisted.');
      if (savedRequest.id !== id) {
        return { id: savedRequest.id, status: savedRequest.status, duplicate: true };
      }
      await trx('audit_log').insert(auditRow(actor, 'fee_adjustment.requested',
        'fee_adjustment_request', id, null, data));
      const principal = await principalForCampus(trx, actor);
      if (principal) await insertNotification(trx, actor, principal.id,
        'fee_adjustment_request', id, 'Adjustment approval requested', data.reason);
      return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        ...data, status: 'pending', requestedBy: actor.sub };
    });
  },
  async listFeeAdjustmentRequests(actor) {
    const rows = await this.db('fee_adjustment_requests').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('created_at', 'desc');
    return rows.map((row) => mapRequest(row, {
      invoiceId: 'invoice_id', adjustmentType: 'adjustment_type',
      amountMinor: (item) => minor(item.amount_minor), reason: 'reason',
      status: 'status', requestedBy: 'requested_by', approvedBy: 'approved_by',
      idempotencyKey: 'idempotency_key', createdAt: (item) => item.created_at,
      updatedAt: (item) => item.updated_at
    }));
  },
  async transitionFeeAdjustment(requestId, targetStatus, actor) {
    return this.db.transaction(async (trx) => {
      const request = await trx('fee_adjustment_requests').where({
        id: requestId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!request) return null;
      if (targetStatus === 'approved' && request.requested_by === actor.sub) {
        throw setupConflict('A requester cannot approve their own adjustment.');
      }
      if (request.status === targetStatus) return { id: request.id, status: request.status };
      if (request.status !== 'pending' || !['approved', 'rejected'].includes(targetStatus)) {
        throw setupConflict('Adjustment request has an invalid state transition.');
      }
      const invoice = await trx('invoices').where({
        id: request.invoice_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!invoice) throw campusScopeError('Invoice is outside the active campus.');
      const beforeBalance = await loadInvoiceBalance(trx, invoice);
      let adjustmentId = null;
      if (targetStatus === 'approved') {
        const balanceMinor = moneyCents(beforeBalance);
        const nextBalance = balanceMinor +
          (request.adjustment_type === 'debit' ? minor(request.amount_minor) : -minor(request.amount_minor));
        if (nextBalance < 0) throw feeConflict('Credit adjustment exceeds the outstanding invoice balance.');
        adjustmentId = randomUUID();
        await trx('fee_adjustments').insert({
          id: adjustmentId, organization_id: actor.orgId, campus_id: actor.activeCampusId,
          invoice_id: invoice.id, request_id: request.id,
          adjustment_type: request.adjustment_type, amount_minor: request.amount_minor,
          reason: request.reason, created_by: actor.sub
        });
      }
      await trx('fee_adjustment_requests').where({ id: request.id }).update({
        status: targetStatus, approved_by: targetStatus === 'approved' ? actor.sub : null,
        updated_at: trx.fn.now()
      });
      const afterBalance = await loadInvoiceBalance(trx, invoice);
      await trx('invoices').where({
        id: invoice.id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).update({ status: statusFromBalance(invoice, afterBalance) });
      await trx('audit_log').insert(auditRow(actor, `fee_adjustment.${targetStatus}`,
        'fee_adjustment_request', requestId, { status: request.status, balanceDue: beforeBalance }, {
          status: targetStatus, approvedBy: targetStatus === 'approved' ? actor.sub : null,
          adjustmentId, balanceDue: afterBalance
        }));
      await notifyRequester(trx, actor, { ...request, status: targetStatus },
        'fee_adjustment_status', 'Adjustment request updated');
      return { id: requestId, status: targetStatus, adjustmentId, balanceDue: afterBalance };
    });
  },
  async getArrearsReport(asOf, actor) {
    const today = asOf ?? addisDate();
    const db = this.db;
    const invoices = await boundedFinanceReportRows(this.db('invoices as i').join('students as s', 's.id', 'i.student_id')
      .leftJoin('enrolments as e', function joinEnrollment() {
        this.on('e.student_id', '=', 's.id').andOn('e.status', '=', db.raw('?', ['active']));
      }).leftJoin('sections as sec', 'sec.id', 'e.section_id')
      .where({
        'i.organization_id': actor.orgId, 'i.campus_id': actor.activeCampusId
      }).whereNotIn('i.status', ['paid', 'void'])
      .select('i.*', 's.student_no', 's.given_name_en', 's.father_name_en',
        's.id as scoped_student_id', 'sec.id as section_id', 'sec.name as section_name'));
    const output = [];
    for (const invoice of invoices) {
      if (!invoice.due_date) continue;
      const balanceDue = await loadInvoiceBalance(this.db, invoice);
      if (balanceDue <= 0) continue;
      const daysOverdue = Math.max(0, Math.floor(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dateOnly(invoice.due_date)}T00:00:00Z`)) / 86400000
      ));
      const bucket = daysOverdue === 0 ? 'current' : daysOverdue <= 30 ? '1_30' :
        daysOverdue <= 60 ? '31_60' : daysOverdue <= 90 ? '61_90' : 'over_90';
      const followups = await boundedFinanceReportRows(this.db('fee_arrears_followups').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, invoice_id: invoice.id
      }).orderBy('created_at', 'desc'));
      output.push({
        invoiceId: invoice.id, invoiceNumber: invoice.invoice_number,
        studentId: invoice.scoped_student_id, studentNo: invoice.student_no,
        studentName: `${invoice.given_name_en} ${invoice.father_name_en}`,
        sectionId: invoice.section_id ?? null, sectionName: invoice.section_name ?? '',
        dueDate: dateOnly(invoice.due_date), daysOverdue, bucket, balanceDue,
        currencyCode: invoice.currency_code, followups: followups.map((item) => ({
          id: item.id, note: item.note, nextContactOn: dateOnly(item.next_contact_on),
          createdBy: item.created_by, createdAt: item.created_at
        }))
      });
    }
    return output.sort((left, right) => right.daysOverdue - left.daysOverdue);
  },
  async createArrearsFollowup(invoiceId, data, actor) {
    const id = randomUUID();
    await this.db.transaction(async (trx) => {
      const invoice = await trx('invoices').where({
        id: invoiceId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!invoice || await loadInvoiceBalance(trx, invoice) <= 0) return;
      await trx('fee_arrears_followups').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        invoice_id: invoiceId, note: data.note, next_contact_on: data.nextContactOn ?? null,
        created_by: actor.sub
      });
      await trx('audit_log').insert(auditRow(actor, 'fee_arrears.followup_created',
        'fee_arrears_followup', id, null, data));
    });
    const row = await this.db('fee_arrears_followups').where({
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first();
    return row ? { id, organizationId: row.organization_id, campusId: row.campus_id,
      invoiceId, note: row.note, nextContactOn: dateOnly(row.next_contact_on),
      createdBy: row.created_by, createdAt: row.created_at } : null;
  },
  async getStudentFeeStatement(studentId, actor) {
    const allowedCampuses = actor.role === 'parent_guardian' || actor.role === 'student'
      ? actor.campusIds ?? [actor.activeCampusId] : [actor.activeCampusId];
    const student = await this.db('students as s').join('campuses as c', 'c.id', 's.campus_id')
      .where({
        's.id': studentId, 'c.organization_id': actor.orgId
      }).whereIn('s.campus_id', allowedCampuses).whereNull('s.archived_at').first('s.*');
    if (!student) throw campusScopeError('Student is outside the active campus.');
    if (actor.role === 'parent_guardian') {
      const linked = await this.db('student_guardians as sg').join('guardians as g', 'g.id', 'sg.guardian_id')
        .where({
          'sg.student_id': studentId, 'sg.is_verified': true, 'sg.can_view_fees': true,
          'g.organization_id': actor.orgId, 'g.user_id': actor.sub
        }).first('sg.student_id');
      if (!linked) throw campusScopeError('Parent does not have fee access to this student.');
    } else if (actor.role === 'student' && student.user_id !== actor.sub) {
      throw campusScopeError('Student can only view their own statement.');
    }
    const rows = await this.db('invoices').where({
      organization_id: actor.orgId, campus_id: student.campus_id, student_id: studentId
    }).whereNot('status', 'void').orderBy('issued_at', 'desc');
    const invoices = [];
    for (const invoice of rows) {
      const balanceDue = await loadInvoiceBalance(this.db, invoice);
      invoices.push({
        id: invoice.id, organizationId: invoice.organization_id, campusId: invoice.campus_id,
        studentId, invoiceNumber: invoice.invoice_number, currencyCode: invoice.currency_code,
        totalAmount: roundMoney(Number(invoice.total_amount)), balanceDue,
        paidAmount: roundMoney(Number(invoice.total_amount) - balanceDue),
        dueDate: dateOnly(invoice.due_date), status: invoice.status
      });
    }
    return { studentId, studentNo: student.student_no, invoices };
  },
  async getFeeReport(type, from, to, actor) {
    if (type === 'expense') {
      const expenses = await boundedFinanceReportRows(this.db('fee_expenses').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereBetween('recorded_on', [from, to]).orderBy('recorded_on'));
      return expenses.map((item) => ({
        id: item.id, date: dateOnly(item.recorded_on), category: item.category,
        description: item.description, studentName: '', amount: roundMoney(Number(item.amount)),
        currencyCode: item.currency_code, method: item.method, entryType: 'expense'
      }));
    }
    if (type === 'outstanding') {
      const invoices = await boundedFinanceReportRows(this.db('invoices as i').join('students as s', 's.id', 'i.student_id')
        .where({
          'i.organization_id': actor.orgId, 'i.campus_id': actor.activeCampusId,
          's.campus_id': actor.activeCampusId
        }).whereBetween('i.due_date', [from, to]).whereNotIn('i.status', ['void'])
        .select('i.*', 's.given_name_en', 's.father_name_en'));
      const result = [];
      for (const invoice of invoices) {
        const balance = await loadInvoiceBalance(this.db, invoice);
        if (balance > 0) result.push({
          invoiceNumber: invoice.invoice_number, studentId: invoice.student_id,
          studentName: `${invoice.given_name_en} ${invoice.father_name_en}`,
          date: dateOnly(invoice.due_date), currencyCode: invoice.currency_code, amount: balance
        });
      }
      return result;
    }
    const payments = await boundedFinanceReportRows(this.db('fee_payments as p').join('invoices as i', function joinInvoice() {
      this.on('i.id', '=', 'p.invoice_id').andOn('i.organization_id', '=', 'p.organization_id')
        .andOn('i.campus_id', '=', 'p.campus_id');
    }).join('students as s', 's.id', 'i.student_id')
      .where({
        'p.organization_id': actor.orgId, 'p.campus_id': actor.activeCampusId,
        'i.organization_id': actor.orgId, 'i.campus_id': actor.activeCampusId
      }).whereBetween('p.recorded_on', [from, to])
      .select('p.*', 'i.invoice_number', 'i.student_id', 'i.currency_code',
        's.student_no', 's.given_name_en', 's.father_name_en', 's.section_name'));
    const mapped = [];
    for (const payment of payments) {
      if (type === 'daily_cash' && payment.method !== 'cash') continue;
      const lineRows = await boundedFinanceReportRows(this.db('invoice_lines as il')
        .leftJoin('fee_items as fi', function joinFeeItem() {
          this.on('fi.id', '=', 'il.fee_item_id').andOn('fi.organization_id', '=', 'il.organization_id')
            .andOn('fi.campus_id', '=', 'il.campus_id');
        }).where({
          'il.organization_id': actor.orgId, 'il.campus_id': actor.activeCampusId,
          'il.invoice_id': payment.invoice_id
        }).select('fi.category'));
      mapped.push({
        date: dateOnly(payment.recorded_on), invoiceNumber: payment.invoice_number,
        studentId: payment.student_id, studentNo: payment.student_no,
        studentName: `${payment.given_name_en} ${payment.father_name_en}`,
        className: payment.section_name ?? 'Unassigned',
        feeTypes: [...new Set(lineRows.map((item) => item.category ?? 'installment'))].join(';'),
        currencyCode: payment.currency_code, amount: roundMoney(Number(payment.amount)),
        entryType: payment.entry_type, method: payment.method
      });
    }
    if (type !== 'class' && type !== 'fee_type' && type !== 'daily_cash' &&
        type !== 'daily_collection') return mapped;
    const groups = new Map();
    for (const row of mapped) {
      const label = type === 'class' ? row.className : type === 'fee_type' ? row.feeTypes : row.date;
      const key = `${label}:${row.currencyCode}`;
      const item = groups.get(key) ?? {
        date: type === 'daily_cash' || type === 'daily_collection' ? row.date : undefined,
        className: type === 'class' ? label : undefined,
        feeTypes: type === 'fee_type' ? label : undefined,
        currencyCode: row.currencyCode, amountMinor: 0
      };
      item.amountMinor += (row.entryType === 'reversal' ? -1 : 1) * moneyCents(row.amount);
      groups.set(key, item);
    }
    return [...groups.values()].map(({ amountMinor: value, ...row }) => ({
      ...row, amount: amount(value)
    }));
  },
  async getFinanceDashboard(actor, asOf = addisDate()) {
    const [payments, arrears, invoices] = await Promise.all([
      this.db('fee_payments as p').join('invoices as i', function joinInvoice() {
        this.on('i.id', '=', 'p.invoice_id').andOn('i.organization_id', '=', 'p.organization_id')
          .andOn('i.campus_id', '=', 'p.campus_id');
      }).where({
        'p.organization_id': actor.orgId, 'p.campus_id': actor.activeCampusId
      }).where('p.recorded_on', asOf).select('p.entry_type', 'p.amount', 'i.currency_code'),
      this.getArrearsReport(asOf, actor),
      this.db('invoices').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).whereNot('status', 'void')
    ]);
    const collections = new Map();
    for (const payment of payments) {
      const value = collections.get(payment.currency_code) ?? 0;
      collections.set(payment.currency_code, value +
        (payment.entry_type === 'reversal' ? -1 : 1) * moneyCents(Number(payment.amount)));
    }
    const outstanding = new Map();
    for (const invoice of invoices) {
      const balance = await loadInvoiceBalance(this.db, invoice);
      if (balance > 0) outstanding.set(invoice.currency_code,
        (outstanding.get(invoice.currency_code) ?? 0) + moneyCents(balance));
    }
    return {
      date: asOf,
      collections: [...collections].map(([currencyCode, value]) => ({
        currencyCode, amount: amount(value)
      })),
      overdueInvoices: arrears.filter((row) => row.daysOverdue > 0).length,
      outstandingByCurrency: [...outstanding].map(([currencyCode, value]) => ({
        currencyCode, amount: amount(value)
      }))
    };
  },
  async listCashbookAccounts(actor) {
    const rows = await this.db('cashbook_accounts').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).orderBy('name');
    return Promise.all(rows.map(async (row) => {
      const balance = await this.db('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, account_id: row.id
      }).select('direction', 'amount_minor');
      return {
        id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
        name: row.name, accountType: row.account_type, currencyCode: row.currency_code,
        openingBalanceMinor: minor(row.opening_balance_minor), isActive: Boolean(row.is_active),
        balanceMinor: minor(row.opening_balance_minor) + balance.reduce((total, entry) =>
          total + (entry.direction === 'credit' ? 1 : -1) * minor(entry.amount_minor), 0)
      };
    }));
  },
  async createCashbookAccount(data, actor) {
    const id = randomUUID();
    const account = {
      id, organization_id: actor.orgId, campus_id: actor.activeCampusId, name: data.name,
      account_type: data.accountType, currency_code: data.currencyCode,
      opening_balance_minor: data.openingBalanceMinor ?? 0, is_active: true,
      idempotency_key: data.idempotencyKey, created_by: actor.sub
    };
    return this.db.transaction(async (trx) => {
      await trx('cashbook_accounts').insert(account)
        .onConflict(['organization_id', 'campus_id', 'idempotency_key']).ignore();
      const savedAccount = await trx('cashbook_accounts').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (!savedAccount) throw setupConflict('Cashbook account name already exists.');
      if (savedAccount.id !== id) return {
        id: savedAccount.id, organizationId: savedAccount.organization_id,
        campusId: savedAccount.campus_id, name: savedAccount.name,
        accountType: savedAccount.account_type, currencyCode: savedAccount.currency_code,
        openingBalanceMinor: minor(savedAccount.opening_balance_minor),
        isActive: Boolean(savedAccount.is_active),
        balanceMinor: minor(savedAccount.opening_balance_minor), duplicate: true
      };
      await trx('audit_log').insert(auditRow(actor, 'cashbook_account.created',
        'cashbook_account', id, null, data));
      return {
        id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        ...data, openingBalanceMinor: account.opening_balance_minor,
        isActive: true, balanceMinor: account.opening_balance_minor
      };
    });
  },
  async createCashbookDeposit(accountId, data, actor) {
    const id = randomUUID();
    return this.db.transaction(async (trx) => {
      const prior = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (prior) return {
        id: prior.id, accountId: prior.account_id, amountMinor: minor(prior.amount_minor),
        direction: prior.direction, idempotencyKey: prior.idempotency_key, duplicate: true
      };
      const account = await trx('cashbook_accounts').where({
        id: accountId, organization_id: actor.orgId,
        campus_id: actor.activeCampusId, is_active: true
      }).forUpdate().first();
      if (!account) return null;
      const duplicate = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: data.idempotencyKey
      }).first();
      if (duplicate) return {
        id: duplicate.id, accountId: duplicate.account_id,
        amountMinor: minor(duplicate.amount_minor), direction: duplicate.direction,
        idempotencyKey: duplicate.idempotency_key, duplicate: true
      };
      if (data.amountMinor <= 0) throw feeConflict('Deposit amount must be positive.');
      const entry = {
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        account_id: accountId, entry_type: 'deposit', direction: 'credit',
        amount_minor: data.amountMinor, currency_code: account.currency_code,
        description: data.description, reference: data.reference ?? null,
        idempotency_key: data.idempotencyKey, created_by: actor.sub,
        recorded_on: data.recordedOn ?? addisDate()
      };
      await trx('cashbook_entries').insert(entry);
      await trx('audit_log').insert(auditRow(actor, 'cashbook.deposit_recorded',
        'cashbook_entry', id, null, data));
      return { id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        accountId, amountMinor: data.amountMinor, direction: 'credit',
        currencyCode: account.currency_code, idempotencyKey: data.idempotencyKey };
    });
  },
  async transferCashbookFunds(data, actor) {
    return this.db.transaction(async (trx) => {
      const prior = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: `${data.idempotencyKey}:debit`
      }).first();
      if (prior) {
        const credit = await trx('cashbook_entries').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          id: prior.related_entry_id
        }).first();
        return { debit: prior, credit, duplicate: true };
      }
      const accounts = await trx('cashbook_accounts').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, is_active: true
      }).whereIn('id', [data.fromAccountId, data.toAccountId]).orderBy('id').forUpdate();
      const from = accounts.find((item) => item.id === data.fromAccountId);
      const to = accounts.find((item) => item.id === data.toAccountId);
      if (!from || !to) throw campusScopeError('Transfer accounts are outside the active campus.');
      const duplicate = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        idempotency_key: `${data.idempotencyKey}:debit`
      }).first();
      if (duplicate) {
        const credit = await trx('cashbook_entries').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          id: duplicate.related_entry_id
        }).first();
        return { debit: duplicate, credit, duplicate: true };
      }
      if (from.id === to.id || from.currency_code !== to.currency_code) {
        throw feeConflict('Transfers require two distinct accounts with the same currency.');
      }
      if (data.amountMinor <= 0) throw feeConflict('Transfer amount must be positive.');
      const entries = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, account_id: from.id
      }).select('direction', 'amount_minor').forUpdate();
      const balance = minor(from.opening_balance_minor) + entries.reduce((sum, item) =>
        sum + (item.direction === 'credit' ? 1 : -1) * minor(item.amount_minor), 0);
      if (balance < data.amountMinor) throw feeConflict('Transfer exceeds the source account balance.');
      const debitId = randomUUID();
      const creditId = randomUUID();
      const common = {
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        entry_type: 'transfer', amount_minor: data.amountMinor,
        currency_code: from.currency_code, description: data.description,
        reference: data.reference ?? null, created_by: actor.sub,
        recorded_on: data.recordedOn ?? addisDate()
      };
      await trx('cashbook_entries').insert({
        ...common, id: debitId, account_id: from.id, direction: 'debit',
        related_entry_id: null, idempotency_key: `${data.idempotencyKey}:debit`
      });
      await trx('cashbook_entries').insert({
        ...common, id: creditId, account_id: to.id, direction: 'credit',
        related_entry_id: debitId, idempotency_key: `${data.idempotencyKey}:credit`
      });
      await trx('cashbook_entries').where({ id: debitId }).update({ related_entry_id: creditId });
      await trx('audit_log').insert(auditRow(actor, 'cashbook.transfer_recorded',
        'cashbook_transfer', data.idempotencyKey, null, { debitId, creditId, ...data }));
      return { debit: { id: debitId, accountId: from.id, direction: 'debit',
        amountMinor: data.amountMinor }, credit: { id: creditId, accountId: to.id,
        direction: 'credit', amountMinor: data.amountMinor } };
    });
  },
  async listCashbookEntries(accountId, from, to, actor) {
    const account = await this.db('cashbook_accounts').where({
      id: accountId, organization_id: actor.orgId, campus_id: actor.activeCampusId
    }).first('id');
    if (!account) return null;
    const rows = await this.db('cashbook_entries').where({
      organization_id: actor.orgId, campus_id: actor.activeCampusId, account_id: accountId
    }).whereBetween('recorded_on', [from, to]).orderBy('recorded_on');
    return rows.map((row) => ({
      id: row.id, organizationId: row.organization_id, campusId: row.campus_id,
      accountId: row.account_id, entryType: row.entry_type, direction: row.direction,
      amountMinor: minor(row.amount_minor), currencyCode: row.currency_code,
      description: row.description, reference: row.reference,
      relatedEntryId: row.related_entry_id, idempotencyKey: row.idempotency_key,
      recordedOn: dateOnly(row.recorded_on), createdAt: row.created_at
    }));
  },
  async reconcileCashbookAccount(accountId, data, actor) {
    return this.db.transaction(async (trx) => {
      const prior = await trx('cashbook_reconciliations').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        account_id: accountId, statement_date: data.statementDate
      }).first();
      if (prior) return {
        id: prior.id, accountId, statementDate: dateOnly(prior.statement_date),
        statementBalanceMinor: minor(prior.statement_balance_minor),
        bookBalanceMinor: minor(prior.book_balance_minor), differenceMinor: minor(prior.difference_minor),
        duplicate: true
      };
      const account = await trx('cashbook_accounts').where({
        id: accountId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!account) return null;
      const repeated = await trx('cashbook_reconciliations').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        account_id: accountId, statement_date: data.statementDate
      }).first();
      if (repeated) return {
        id: repeated.id, accountId, statementDate: dateOnly(repeated.statement_date),
        statementBalanceMinor: minor(repeated.statement_balance_minor),
        bookBalanceMinor: minor(repeated.book_balance_minor),
        differenceMinor: minor(repeated.difference_minor), duplicate: true
      };
      const entries = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId, account_id: accountId
      }).where('recorded_on', '<=', data.statementDate).forUpdate();
      const bookBalanceMinor = minor(account.opening_balance_minor) + entries.reduce((sum, item) =>
        sum + (item.direction === 'credit' ? 1 : -1) * minor(item.amount_minor), 0);
      const id = randomUUID();
      await trx('cashbook_reconciliations').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        account_id: accountId, statement_date: data.statementDate,
        statement_balance_minor: data.statementBalanceMinor, book_balance_minor: bookBalanceMinor,
        difference_minor: data.statementBalanceMinor - bookBalanceMinor, created_by: actor.sub
      });
      const unreconciled = [];
      for (const entry of entries) {
        const linked = await trx('cashbook_reconciliation_entries').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, entry_id: entry.id
        }).first('entry_id');
        if (!linked) unreconciled.push({
          organization_id: actor.orgId, campus_id: actor.activeCampusId,
          reconciliation_id: id, entry_id: entry.id
        });
      }
      if (unreconciled.length) await trx('cashbook_reconciliation_entries').insert(unreconciled);
      await trx('audit_log').insert(auditRow(actor, 'cashbook.reconciled',
        'cashbook_reconciliation', id, null, {
          accountId, statementDate: data.statementDate,
          statementBalanceMinor: data.statementBalanceMinor,
          bookBalanceMinor, differenceMinor: data.statementBalanceMinor - bookBalanceMinor
        }));
      return {
        id, organizationId: actor.orgId, campusId: actor.activeCampusId,
        accountId, statementDate: data.statementDate,
        statementBalanceMinor: data.statementBalanceMinor, bookBalanceMinor,
        differenceMinor: data.statementBalanceMinor - bookBalanceMinor
      };
    });
  },
  async reverseCashbookEntry(entryId, data, actor) {
    return this.db.transaction(async (trx) => {
      const prior = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        entry_type: 'reversal', related_entry_id: entryId
      }).first();
      if (prior) return { ...prior, duplicate: true };
      const entry = await trx('cashbook_entries').where({
        id: entryId, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!entry) return null;
      const repeated = await trx('cashbook_entries').where({
        organization_id: actor.orgId, campus_id: actor.activeCampusId,
        entry_type: 'reversal', related_entry_id: entryId
      }).first();
      if (repeated) return { ...repeated, duplicate: true };
      const account = await trx('cashbook_accounts').where({
        id: entry.account_id, organization_id: actor.orgId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      const direction = entry.direction === 'credit' ? 'debit' : 'credit';
      if (direction === 'debit') {
        const entries = await trx('cashbook_entries').where({
          organization_id: actor.orgId, campus_id: actor.activeCampusId, account_id: account.id
        }).select('direction', 'amount_minor');
        const balance = minor(account.opening_balance_minor) + entries.reduce((sum, item) =>
          sum + (item.direction === 'credit' ? 1 : -1) * minor(item.amount_minor), 0);
        if (balance < minor(entry.amount_minor)) {
          throw feeConflict('Cashbook reversal would create a negative account balance.');
        }
      }
      const id = randomUUID();
      await trx('cashbook_entries').insert({
        id, organization_id: actor.orgId, campus_id: actor.activeCampusId,
        account_id: entry.account_id, entry_type: 'reversal', direction,
        amount_minor: entry.amount_minor, currency_code: entry.currency_code,
        description: data.reason, reference: entry.reference, related_entry_id: entry.id,
        idempotency_key: data.idempotencyKey, created_by: actor.sub, recorded_on: addisDate()
      });
      await trx('audit_log').insert(auditRow(actor, 'cashbook.entry_reversed',
        'cashbook_entry', entry.id, entry, { reversalId: id, reason: data.reason }));
      return { id, accountId: entry.account_id, entryType: 'reversal',
        direction, amountMinor: minor(entry.amount_minor), relatedEntryId: entry.id };
    });
  }
};
