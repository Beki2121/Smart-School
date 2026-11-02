import { randomUUID } from 'node:crypto';
import { addisDate, auditRow, campusScopeError, feeConflict, now, setupConflict } from '../shared.js';
import {
  feeBalanceFromLedger, feeInvoiceView, mapCashierShift, mapFeeExpense, mapFeeItem, mapFeePayment,
  moneyCents, roundMoney
} from '../fees.mappers.js';

async function loadMysqlFeeInvoice(db, row) {
  if (!row) return null;
  const [lines, payments] = await Promise.all([
    db('invoice_lines').where({ invoice_id: row.id }).orderBy('id'),
    db('fee_payments').where({ invoice_id: row.id }).orderBy('recorded_at')
  ]);
  const invoice = {
    id: row.id, campusId: row.campus_id, studentId: row.student_id,
    studentNo: row.student_no, studentName: row.given_name_en
      ? `${row.given_name_en} ${row.father_name_en}` : undefined,
    invoiceNumber: row.invoice_number, currencyCode: row.currency_code,
    totalAmount: roundMoney(Number(row.total_amount)),
    dueDate: row.due_date == null ? null : String(row.due_date).slice(0, 10),
    status: row.status, issuedBy: row.issued_by, createdAt: row.issued_at,
    lines: lines.map((line) => ({
      id: line.id, feeItemId: line.fee_item_id,
      descriptionEn: line.description_en, descriptionAm: line.description_am,
      unitAmount: roundMoney(Number(line.unit_amount)), quantity: line.quantity,
      lineTotal: roundMoney(Number(line.line_total))
    }))
  };
  return feeInvoiceView(invoice, payments.map((payment) => mapFeePayment(payment)));
}

export const mysqlFeesBundle = {
  async listFeeItems(campusId) {
    const rows = await this.db('fee_items').where({ campus_id: campusId }).orderBy('code');
    return rows.map(mapFeeItem);
  },
  async createFeeItem(data, actor) {
    const id = randomUUID();
    try {
      await this.db.transaction(async (trx) => {
        await trx('fee_items').insert({
          id, campus_id: actor.activeCampusId, code: data.code,
          name_en: data.nameEn, name_am: data.nameAm, category: data.category ?? 'core', amount: data.amount,
          currency_code: data.currencyCode, is_active: true
        });
        await trx('audit_log').insert(auditRow(actor, 'fee_item.created', 'fee_item', id, null, data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Fee item code already exists at this campus.');
      throw error;
    }
    return { id, campusId: actor.activeCampusId, isActive: true, ...data };
  },
  async updateFeeItem(itemId, data, actor) {
    const before = await this.db('fee_items').where({
      id: itemId, campus_id: actor.activeCampusId
    }).first();
    if (!before) return null;
    try {
      await this.db.transaction(async (trx) => {
        await trx('fee_items').where({ id: itemId, campus_id: actor.activeCampusId }).update({
          code: data.code, name_en: data.nameEn, name_am: data.nameAm,
          amount: data.amount, currency_code: data.currencyCode, is_active: data.isActive
        });
        await trx('audit_log').insert(auditRow(actor, 'fee_item.updated', 'fee_item', itemId,
          mapFeeItem(before), data));
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') throw setupConflict('Fee item code already exists at this campus.');
      throw error;
    }
    return { id: itemId, campusId: actor.activeCampusId, ...data };
  },
  async getActiveCashierShift(actor) {
    const row = await this.db('cashier_shifts').where({
      campus_id: actor.activeCampusId, opened_by: actor.sub, status: 'open'
    }).orderBy('opened_at', 'desc').first();
    return row ? mapCashierShift(row) : null;
  },
  async listCashierShifts(actor) {
    const query = this.db('cashier_shifts').where({ campus_id: actor.activeCampusId });
    if (actor.role === 'accountant_cashier') query.andWhere({ opened_by: actor.sub });
    return (await query.orderBy('opened_at', 'desc').limit(50)).map(mapCashierShift);
  },
  async openCashierShift(data, actor) {
    const id = randomUUID();
    const row = await this.db.transaction(async (trx) => {
      await trx('users').where({
        id: actor.sub, organization_id: actor.orgId, is_active: true
      }).forUpdate().first('id');
      const active = await trx('cashier_shifts').where({
        campus_id: actor.activeCampusId, opened_by: actor.sub, status: 'open'
      }).forUpdate().first('id');
      if (active) throw feeConflict('Close your active cashier shift before opening another.');
      const values = {
        id, campus_id: actor.activeCampusId, opened_by: actor.sub, currency_code: data.currencyCode,
        opening_float: data.openingFloat, status: 'open', recorded_on: addisDate()
      };
      await trx('cashier_shifts').insert(values);
      await trx('audit_log').insert(auditRow(actor, 'cashier_shift.opened', 'cashier_shift', id, null, {
        currencyCode: data.currencyCode, openingFloat: data.openingFloat
      }));
      return trx('cashier_shifts').where({ id }).first();
    });
    return mapCashierShift(row);
  },
  async closeCashierShift(shiftId, data, actor) {
    let result;
    await this.db.transaction(async (trx) => {
      const shift = await trx('cashier_shifts').where({
        id: shiftId, campus_id: actor.activeCampusId,
        opened_by: actor.sub, status: 'open'
      }).forUpdate().first();
      if (!shift) return;
      const [payments, reversals, expenses] = await Promise.all([
        trx('fee_payments').where({
          cashier_shift_id: shiftId, entry_type: 'payment', method: 'cash'
        }).sum({ total: 'amount' }).first(),
        trx('fee_payments').where({
          cashier_shift_id: shiftId, entry_type: 'reversal', method: 'cash'
        }).sum({ total: 'amount' }).first(),
        trx('fee_expenses').where({ cashier_shift_id: shiftId, method: 'cash' })
          .sum({ total: 'amount' }).first()
      ]);
      const expectedCash = roundMoney((
        moneyCents(Number(shift.opening_float)) + moneyCents(Number(payments.total ?? 0)) -
        moneyCents(Number(reversals.total ?? 0)) - moneyCents(Number(expenses.total ?? 0))
      ) / 100);
      const variance = roundMoney(data.closingCash - expectedCash);
      await trx('cashier_shifts').where({ id: shiftId }).update({
        status: 'closed', closed_by: actor.sub, closed_at: trx.fn.now(),
        closing_cash: data.closingCash, expected_cash: expectedCash, variance
      });
      await trx('audit_log').insert(auditRow(actor, 'cashier_shift.closed', 'cashier_shift', shiftId,
        { status: 'open' }, {
          status: 'closed', closingCash: data.closingCash, expectedCash, variance
        }));
      result = await trx('cashier_shifts').where({ id: shiftId }).first();
    });
    return result ? mapCashierShift(result) : null;
  },
  async listFeeExpenses(campusId, from, to) {
    return (await this.db('fee_expenses').where({ campus_id: campusId })
      .whereBetween('recorded_on', [from, to]).orderBy('recorded_at', 'desc').limit(250))
      .map(mapFeeExpense);
  },
  async createFeeExpense(data, actor) {
    const id = randomUUID();
    const row = await this.db.transaction(async (trx) => {
      const shift = await trx('cashier_shifts').where({
        campus_id: actor.activeCampusId, opened_by: actor.sub, status: 'open'
      }).forUpdate().first();
      if (!shift) throw feeConflict('Open a cashier shift before recording financial activity.');
      if (shift.currency_code !== data.currencyCode) throw feeConflict('Expense currency must match the active cashier shift.');
      const values = {
        id, campus_id: actor.activeCampusId, cashier_shift_id: shift.id,
        category: data.category, description: data.description, amount: data.amount,
        currency_code: data.currencyCode, method: data.method, reference: data.reference || null,
        recorded_by: actor.sub, recorded_on: addisDate()
      };
      await trx('fee_expenses').insert(values);
      await trx('audit_log').insert(auditRow(actor, 'fee_expense.recorded', 'fee_expense', id, null, {
        cashierShiftId: shift.id, category: data.category, amount: data.amount,
        currencyCode: data.currencyCode, method: data.method, reference: data.reference || null
      }));
      return trx('fee_expenses').where({ id }).first();
    });
    return mapFeeExpense(row);
  },
  async getFeeSummary(campusId, from, to) {
    const [payments, expenses] = await Promise.all([
      this.db('fee_payments as p').join('invoices as i', 'i.id', 'p.invoice_id')
        .where({ 'p.campus_id': campusId, 'i.campus_id': campusId })
        .whereBetween('p.recorded_on', [from, to])
        .select('p.entry_type', 'i.currency_code').sum({ total: 'p.amount' })
        .groupBy('p.entry_type', 'i.currency_code'),
      this.db('fee_expenses').where({ campus_id: campusId }).whereBetween('recorded_on', [from, to])
        .select('currency_code').sum({ total: 'amount' }).groupBy('currency_code')
    ]);
    const totals = new Map();
    const currency = (code) => {
      if (!totals.has(code)) totals.set(code, { currencyCode: code, payments: 0, reversals: 0, income: 0, expenses: 0, net: 0 });
      return totals.get(code);
    };
    for (const row of payments) {
      const summary = currency(row.currency_code);
      summary[row.entry_type === 'reversal' ? 'reversals' : 'payments'] = moneyCents(Number(row.total ?? 0));
    }
    for (const row of expenses) currency(row.currency_code).expenses = moneyCents(Number(row.total ?? 0));
    return [...totals.values()].map((row) => ({
      currencyCode: row.currencyCode,
      payments: roundMoney(row.payments / 100), reversals: roundMoney(row.reversals / 100),
      income: roundMoney((row.payments - row.reversals) / 100),
      expenses: roundMoney(row.expenses / 100),
      net: roundMoney((row.payments - row.reversals - row.expenses) / 100)
    }));
  },
  async listFeeInvoices(campusId, studentId) {
    const query = this.db('invoices as i')
      .join('students as s', 's.id', 'i.student_id')
      .where({ 'i.campus_id': campusId, 's.campus_id': campusId });
    if (studentId) query.andWhere({ 'i.student_id': studentId });
    const rows = await query.orderBy('i.issued_at', 'desc').limit(250)
      .select('i.*', 's.student_no', 's.given_name_en', 's.father_name_en');
    return Promise.all(rows.map((row) => loadMysqlFeeInvoice(this.db, row)));
  },
  async createFeeInvoice(data, actor) {
    const id = randomUUID();
    const lineIds = data.lines.map(() => randomUUID());
    const invoiceNumber = `INV-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const result = await this.db.transaction(async (trx) => {
      const student = await trx('students').where({
        id: data.studentId, campus_id: actor.activeCampusId
      }).whereNull('archived_at').first('id');
      if (!student) throw campusScopeError('Student is outside the active campus.');
      const itemIds = data.lines.map((line) => line.feeItemId);
      const items = await trx('fee_items').where({
        campus_id: actor.activeCampusId, is_active: true
      }).whereIn('id', itemIds).forUpdate();
      if (items.length !== itemIds.length) throw campusScopeError('Fee item is not active at this campus.');
      const itemById = new Map(items.map((item) => [item.id, item]));
      const currencyCodes = new Set(items.map((item) => item.currency_code));
      if (currencyCodes.size !== 1) throw feeConflict('All invoice lines must use the same currency.');
      const lines = data.lines.map((line, index) => {
        const item = itemById.get(line.feeItemId);
        const unitAmount = roundMoney(Number(item.amount));
        return {
          id: lineIds[index], invoice_id: id, fee_item_id: item.id,
          description_en: item.name_en, description_am: item.name_am,
          unit_amount: unitAmount, quantity: line.quantity,
          line_total: roundMoney(unitAmount * line.quantity)
        };
      });
      const totalAmount = roundMoney(lines.reduce((total, line) => total + line.line_total, 0));
      await trx('invoices').insert({
        id, campus_id: actor.activeCampusId, student_id: data.studentId,
        invoice_number: invoiceNumber, currency_code: items[0].currency_code,
        total_amount: totalAmount, due_date: data.dueDate ?? null, status: 'issued',
        issued_by: actor.sub
      });
      await trx('invoice_lines').insert(lines);
      await trx('audit_log').insert(auditRow(actor, 'fee_invoice.issued', 'invoice', id, null, {
        invoiceNumber, studentId: data.studentId, totalAmount,
        currencyCode: items[0].currency_code, dueDate: data.dueDate ?? null,
        lines: lines.map((line) => ({
          feeItemId: line.fee_item_id, descriptionEn: line.description_en,
          descriptionAm: line.description_am,
          unitAmount: line.unit_amount, quantity: line.quantity, lineTotal: line.line_total
        }))
      }));
      return { id, campusId: actor.activeCampusId };
    });
    const row = await this.db('invoices as i')
      .join('students as s', 's.id', 'i.student_id')
      .where({ 'i.id': result.id, 'i.campus_id': actor.activeCampusId })
      .first('i.*', 's.student_no', 's.given_name_en', 's.father_name_en');
    return loadMysqlFeeInvoice(this.db, row);
  },
  async voidFeeInvoice(invoiceId, data, actor) {
    let found = false;
    await this.db.transaction(async (trx) => {
      const invoice = await trx('invoices').where({
        id: invoiceId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!invoice) return;
      found = true;
      const payment = await trx('fee_payments').where({ invoice_id: invoiceId }).first('id');
      if (invoice.status !== 'issued' || payment) {
        throw feeConflict('Only an unpaid invoice with no payment history can be voided.');
      }
      await trx('invoices').where({ id: invoiceId }).update({ status: 'void' });
      await trx('audit_log').insert(auditRow(actor, 'fee_invoice.voided', 'invoice', invoiceId,
        { status: invoice.status }, { status: 'void', reason: data.reason }));
    });
    if (!found) return null;
    const row = await this.db('invoices as i').join('students as s', 's.id', 'i.student_id')
      .where({ 'i.id': invoiceId, 'i.campus_id': actor.activeCampusId })
      .first('i.*', 's.student_no', 's.given_name_en', 's.father_name_en');
    return loadMysqlFeeInvoice(this.db, row);
  },
  async recordFeePayment(invoiceId, data, actor) {
    const paymentId = randomUUID();
    const receiptNumber = `RCP-${paymentId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    let output = null;
    await this.db.transaction(async (trx) => {
      const invoice = await trx('invoices').where({
        id: invoiceId, campus_id: actor.activeCampusId
      }).forUpdate().first();
      if (!invoice) return;
      if (invoice.status === 'void') throw feeConflict('A void invoice cannot receive payments.');
      const shift = await trx('cashier_shifts').where({
        campus_id: actor.activeCampusId, opened_by: actor.sub, status: 'open'
      }).forUpdate().first();
      if (!shift) throw feeConflict('Open a cashier shift before recording financial activity.');
      if (shift.currency_code !== invoice.currency_code) {
        throw feeConflict('Invoice currency must match the active cashier shift.');
      }
      const ledger = await trx('fee_payments').where({ invoice_id: invoiceId })
        .select('entry_type', 'amount');
      const balance = feeBalanceFromLedger(Number(invoice.total_amount), ledger);
      const previousStatus = invoice.status;
      if (moneyCents(data.amount) > moneyCents(balance)) {
        throw feeConflict('Payment exceeds the outstanding invoice balance.');
      }
      const status = moneyCents(balance) === moneyCents(data.amount) ? 'paid' : 'partially_paid';
      await trx('fee_payments').insert({
        id: paymentId, campus_id: actor.activeCampusId, invoice_id: invoiceId,
        receipt_number: receiptNumber, entry_type: 'payment',
        amount: data.amount, method: data.method, reference: data.reference || null,
        cashier_shift_id: shift.id, recorded_on: addisDate(), recorded_by: actor.sub
      });
      await trx('invoices').where({ id: invoiceId }).update({ status });
      await trx('audit_log').insert(auditRow(actor, 'fee_payment.recorded', 'fee_payment', paymentId,
        { invoiceStatus: previousStatus, balanceDue: balance }, {
          invoiceId, cashierShiftId: shift.id, amount: data.amount,
          method: data.method, receiptNumber, invoiceStatus: status,
          balanceDue: roundMoney(balance - data.amount)
        }));
      output = { ...invoice, status, cashier_shift_id: shift.id, balanceDue: roundMoney(balance - data.amount) };
    });
    if (!output) return null;
    return {
      id: paymentId, campusId: actor.activeCampusId, invoiceId, receiptNumber,
      entryType: 'payment', amount: roundMoney(data.amount), method: data.method,
      reference: data.reference || null, cashierShiftId: output.cashier_shift_id,
      recordedOn: addisDate(), recordedBy: actor.sub, recordedAt: now(),
      balanceDue: output.balanceDue, currencyCode: output.currency_code
    };
  },
  async reverseFeePayment(paymentId, data, actor) {
    const reversalId = randomUUID();
    let output = null;
    await this.db.transaction(async (trx) => {
      const payment = await trx('fee_payments').where({
        id: paymentId, campus_id: actor.activeCampusId, entry_type: 'payment'
      }).forUpdate().first();
      if (!payment) return;
      const invoice = await trx('invoices').where({
        id: payment.invoice_id, campus_id: actor.activeCampusId
      }).forUpdate().first();
      const shift = await trx('cashier_shifts').where({
        campus_id: actor.activeCampusId, opened_by: actor.sub, status: 'open'
      }).forUpdate().first();
      if (!shift) throw feeConflict('Open a cashier shift before recording financial activity.');
      if (shift.currency_code !== invoice.currency_code) {
        throw feeConflict('Payment currency must match the active cashier shift.');
      }
      const prior = await trx('fee_payments').where({
        reverses_payment_id: paymentId, entry_type: 'reversal'
      }).sum({ total: 'amount' }).first();
      const previousLedger = await trx('fee_payments').where({ invoice_id: invoice.id })
        .select('entry_type', 'amount');
      const previousBalance = feeBalanceFromLedger(Number(invoice.total_amount), previousLedger);
      const previousStatus = invoice.status;
      const reversible = moneyCents(Number(payment.amount)) - moneyCents(Number(prior.total ?? 0));
      if (moneyCents(data.amount) > reversible) {
        throw feeConflict('Reversal exceeds the unreversed payment amount.');
      }
      await trx('fee_payments').insert({
        id: reversalId, campus_id: actor.activeCampusId, invoice_id: invoice.id,
        entry_type: 'reversal', reverses_payment_id: paymentId, amount: data.amount,
        method: payment.method, reason: data.reason, cashier_shift_id: shift.id,
        recorded_on: addisDate(), recorded_by: actor.sub
      });
      const ledger = await trx('fee_payments').where({ invoice_id: invoice.id })
        .select('entry_type', 'amount');
      const balance = feeBalanceFromLedger(Number(invoice.total_amount), ledger);
      const status = moneyCents(balance) === 0 ? 'paid' :
        moneyCents(balance) === moneyCents(Number(invoice.total_amount)) ? 'issued' : 'partially_paid';
      await trx('invoices').where({ id: invoice.id }).update({ status });
      await trx('audit_log').insert(auditRow(actor, 'fee_payment.reversed', 'fee_payment', paymentId,
        { invoiceStatus: previousStatus, balanceDue: previousBalance }, {
          reversalId, cashierShiftId: shift.id, amount: data.amount, reason: data.reason,
          invoiceStatus: status, balanceDue: balance
        }));
      output = {
        invoiceId: invoice.id, balanceDue: balance,
        currencyCode: invoice.currency_code, cashier_shift_id: shift.id
      };
    });
    return output && {
      id: reversalId, campusId: actor.activeCampusId, invoiceId: output.invoiceId,
      receiptNumber: null, entryType: 'reversal', reversesPaymentId: paymentId,
      amount: roundMoney(data.amount), reason: data.reason,
      cashierShiftId: output.cashier_shift_id, recordedOn: addisDate(),
      recordedBy: actor.sub, recordedAt: now(), balanceDue: output.balanceDue,
      currencyCode: output.currencyCode
    };
  },
  async getFeeReceipt(campusId, receiptNumber) {
    const payment = await this.db('fee_payments as p').join('invoices as i', 'i.id', 'p.invoice_id')
      .join('students as s', 's.id', 'i.student_id')
      .where({
        'p.campus_id': campusId, 'p.receipt_number': receiptNumber,
        'p.entry_type': 'payment', 'i.campus_id': campusId
      })
      .first('p.*', 'i.invoice_number', 'i.currency_code', 'i.total_amount',
        'i.student_id', 's.student_no', 's.given_name_en', 's.father_name_en');
    return payment ? mapFeePayment(payment, {
      invoiceNumber: payment.invoice_number, currencyCode: payment.currency_code,
      invoiceTotal: Number(payment.total_amount), studentId: payment.student_id,
      studentNo: payment.student_no, studentName: `${payment.given_name_en} ${payment.father_name_en}`
    }) : null;
  }
};
