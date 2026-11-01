import { randomUUID } from 'node:crypto';
import { addisDate, feeConflict, now, setupConflict, campusScopeError } from '../shared.js';
import {
  feeInvoiceBalance, feeInvoiceView, moneyCents, roundMoney
} from '../fees.mappers.js';

export const memoryFeesBundle = {
  async listFeeItems(campusId) {
    return this.feeItems.filter((item) => item.campusId === campusId)
      .sort((a, b) => a.code.localeCompare(b.code));
  },
  async createFeeItem(data, actor) {
    if (this.feeItems.some((item) =>
      item.campusId === actor.activeCampusId && item.code.toLowerCase() === data.code.toLowerCase())) {
      throw setupConflict('Fee item code already exists at this campus.');
    }
    const item = { id: randomUUID(), campusId: actor.activeCampusId, isActive: true, ...data };
    this.feeItems.push(item);
    await this.appendAudit(actor, 'fee_item.created', 'fee_item', item.id, null, item);
    return item;
  },
  async updateFeeItem(itemId, data, actor) {
    const item = this.feeItems.find((entry) =>
      entry.id === itemId && entry.campusId === actor.activeCampusId);
    if (!item) return null;
    if (this.feeItems.some((entry) =>
      entry.id !== itemId && entry.campusId === actor.activeCampusId &&
      entry.code.toLowerCase() === data.code.toLowerCase())) {
      throw setupConflict('Fee item code already exists at this campus.');
    }
    const before = { ...item };
    Object.assign(item, data);
    await this.appendAudit(actor, 'fee_item.updated', 'fee_item', item.id, before, item);
    return item;
  },
  async getActiveCashierShift(actor) {
    return this.cashierShifts.find((shift) =>
      shift.campusId === actor.activeCampusId && shift.openedBy === actor.sub && shift.status === 'open') ?? null;
  },
  async listCashierShifts(actor) {
    return this.cashierShifts.filter((shift) =>
      shift.campusId === actor.activeCampusId &&
      (actor.role !== 'accountant_cashier' || shift.openedBy === actor.sub))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 50);
  },
  async openCashierShift(data, actor) {
    if (await this.getActiveCashierShift(actor)) {
      throw feeConflict('Close your active cashier shift before opening another.');
    }
    const shift = {
      id: randomUUID(), campusId: actor.activeCampusId, openedBy: actor.sub, closedBy: null,
      currencyCode: data.currencyCode, openingFloat: roundMoney(data.openingFloat),
      closingCash: null, expectedCash: null, variance: null, status: 'open',
      recordedOn: addisDate(), openedAt: now(), closedAt: null
    };
    this.cashierShifts.unshift(shift);
    await this.appendAudit(actor, 'cashier_shift.opened', 'cashier_shift', shift.id, null, {
      currencyCode: shift.currencyCode, openingFloat: shift.openingFloat
    });
    return shift;
  },
  async closeCashierShift(shiftId, data, actor) {
    const shift = this.cashierShifts.find((entry) =>
      entry.id === shiftId && entry.campusId === actor.activeCampusId &&
      entry.openedBy === actor.sub && entry.status === 'open');
    if (!shift) return null;
    const cashPayments = this.feePayments.filter((payment) =>
      payment.cashierShiftId === shift.id && payment.entryType === 'payment' && payment.method === 'cash')
      .reduce((total, payment) => total + moneyCents(payment.amount), 0);
    const cashReversals = this.feePayments.filter((payment) =>
      payment.cashierShiftId === shift.id && payment.entryType === 'reversal' && payment.method === 'cash')
      .reduce((total, payment) => total + moneyCents(payment.amount), 0);
    const cashExpenses = this.feeExpenses.filter((expense) =>
      expense.cashierShiftId === shift.id && expense.method === 'cash')
      .reduce((total, expense) => total + moneyCents(expense.amount), 0);
    const expectedCash = roundMoney((moneyCents(shift.openingFloat) + cashPayments - cashReversals - cashExpenses) / 100);
    Object.assign(shift, {
      closingCash: roundMoney(data.closingCash), expectedCash,
      variance: roundMoney(data.closingCash - expectedCash), status: 'closed',
      closedBy: actor.sub, closedAt: now()
    });
    await this.appendAudit(actor, 'cashier_shift.closed', 'cashier_shift', shift.id,
      { status: 'open' }, {
        status: shift.status, closingCash: shift.closingCash,
        expectedCash: shift.expectedCash, variance: shift.variance
      });
    return shift;
  },
  async listFeeExpenses(campusId, from, to) {
    return this.feeExpenses.filter((expense) =>
      expense.campusId === campusId && expense.recordedOn >= from && expense.recordedOn <= to)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 250);
  },
  async createFeeExpense(data, actor) {
    const shift = await this.getActiveCashierShift(actor);
    if (!shift) throw feeConflict('Open a cashier shift before recording financial activity.');
    if (shift.currencyCode !== data.currencyCode) throw feeConflict('Expense currency must match the active cashier shift.');
    const expense = {
      id: randomUUID(), campusId: actor.activeCampusId, cashierShiftId: shift.id,
      category: data.category, description: data.description, amount: roundMoney(data.amount),
      currencyCode: data.currencyCode, method: data.method, reference: data.reference || null,
      recordedBy: actor.sub, recordedOn: addisDate(), recordedAt: now()
    };
    this.feeExpenses.unshift(expense);
    await this.appendAudit(actor, 'fee_expense.recorded', 'fee_expense', expense.id, null, {
      cashierShiftId: shift.id, category: expense.category, amount: expense.amount,
      currencyCode: expense.currencyCode, method: expense.method, reference: expense.reference
    });
    return expense;
  },
  async getFeeSummary(campusId, from, to) {
    const totals = new Map();
    const currency = (code) => {
      if (!totals.has(code)) totals.set(code, { currencyCode: code, payments: 0, reversals: 0, income: 0, expenses: 0, net: 0 });
      return totals.get(code);
    };
    this.feePayments.filter((payment) =>
      payment.campusId === campusId && payment.recordedOn >= from && payment.recordedOn <= to)
      .forEach((payment) => {
        const summary = currency(payment.currencyCode);
        const amount = moneyCents(payment.amount);
        if (payment.entryType === 'reversal') summary.reversals += amount;
        else summary.payments += amount;
      });
    this.feeExpenses.filter((expense) =>
      expense.campusId === campusId && expense.recordedOn >= from && expense.recordedOn <= to)
      .forEach((expense) => { currency(expense.currencyCode).expenses += moneyCents(expense.amount); });
    return [...totals.values()].map((row) => {
      row.income = row.payments - row.reversals;
      row.net = row.income - row.expenses;
      return {
        currencyCode: row.currencyCode, payments: roundMoney(row.payments / 100),
        reversals: roundMoney(row.reversals / 100), income: roundMoney(row.income / 100),
        expenses: roundMoney(row.expenses / 100), net: roundMoney(row.net / 100)
      };
    });
  },
  async listFeeInvoices(campusId, studentId) {
    return this.feeInvoices.filter((invoice) =>
      invoice.campusId === campusId && (!studentId || invoice.studentId === studentId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((invoice) => feeInvoiceView(invoice, this.feePayments));
  },
  async createFeeInvoice(data, actor) {
    const student = this.students.find((entry) =>
      entry.id === data.studentId && entry.campusId === actor.activeCampusId && !entry.archivedAt);
    if (!student) throw campusScopeError('Student is outside the active campus.');
    const items = data.lines.map((line) => {
      const item = this.feeItems.find((entry) =>
        entry.id === line.feeItemId && entry.campusId === actor.activeCampusId && entry.isActive);
      if (!item) throw campusScopeError('Fee item is not active at this campus.');
      return { feeItemId: item.id, descriptionEn: item.nameEn, descriptionAm: item.nameAm,
        unitAmount: item.amount, quantity: line.quantity,
        lineTotal: roundMoney(item.amount * line.quantity), currencyCode: item.currencyCode };
    });
    const currencies = new Set(items.map((line) => line.currencyCode));
    if (currencies.size !== 1) throw feeConflict('All invoice lines must use the same currency.');
    const totalAmount = roundMoney(items.reduce((total, line) => total + line.lineTotal, 0));
    const id = randomUUID();
    const invoice = {
      id, campusId: actor.activeCampusId, studentId: data.studentId,
      invoiceNumber: `INV-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      currencyCode: items[0].currencyCode, totalAmount, dueDate: data.dueDate ?? null,
      status: 'issued', lines: items.map((line) => ({ id: randomUUID(), ...line })),
      createdAt: now(), issuedBy: actor.sub
    };
    this.feeInvoices.unshift(invoice);
    await this.appendAudit(actor, 'fee_invoice.issued', 'invoice', id, null, {
      invoiceNumber: invoice.invoiceNumber, studentId: invoice.studentId,
      totalAmount, currencyCode: invoice.currencyCode, dueDate: invoice.dueDate, lines: invoice.lines
    });
    return feeInvoiceView(invoice, this.feePayments);
  },
  async voidFeeInvoice(invoiceId, data, actor) {
    const invoice = this.feeInvoices.find((entry) =>
      entry.id === invoiceId && entry.campusId === actor.activeCampusId);
    if (!invoice) return null;
    if (invoice.status !== 'issued' || this.feePayments.some((payment) => payment.invoiceId === invoiceId)) {
      throw feeConflict('Only an unpaid invoice with no payment history can be voided.');
    }
    const before = { status: invoice.status };
    invoice.status = 'void';
    await this.appendAudit(actor, 'fee_invoice.voided', 'invoice', invoice.id, before, {
      status: invoice.status, reason: data.reason
    });
    return feeInvoiceView(invoice, this.feePayments);
  },
  async recordFeePayment(invoiceId, data, actor) {
    const invoice = this.feeInvoices.find((entry) =>
      entry.id === invoiceId && entry.campusId === actor.activeCampusId);
    if (!invoice) return null;
    if (invoice.status === 'void') throw feeConflict('A void invoice cannot receive payments.');
    const shift = await this.getActiveCashierShift(actor);
    if (!shift) throw feeConflict('Open a cashier shift before recording financial activity.');
    if (shift.currencyCode !== invoice.currencyCode) throw feeConflict('Invoice currency must match the active cashier shift.');
    const balance = feeInvoiceBalance(invoice, this.feePayments);
    if (moneyCents(data.amount) > moneyCents(balance)) throw feeConflict('Payment exceeds the outstanding invoice balance.');
    const payment = {
      id: randomUUID(), campusId: actor.activeCampusId, invoiceId,
      receiptNumber: `RCP-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      entryType: 'payment', amount: roundMoney(data.amount), method: data.method,
      reference: data.reference || null, recordedBy: actor.sub, cashierShiftId: shift.id,
      currencyCode: invoice.currencyCode, recordedOn: addisDate(), recordedAt: now()
    };
    this.feePayments.push(payment);
    invoice.status = moneyCents(balance) === moneyCents(data.amount) ? 'paid' : 'partially_paid';
    await this.appendAudit(actor, 'fee_payment.recorded', 'fee_payment', payment.id, null, {
      invoiceId, amount: payment.amount, method: payment.method, receiptNumber: payment.receiptNumber
    });
    return { ...payment, balanceDue: roundMoney(balance - payment.amount), currencyCode: invoice.currencyCode };
  },
  async reverseFeePayment(paymentId, data, actor) {
    const payment = this.feePayments.find((entry) =>
      entry.id === paymentId && entry.campusId === actor.activeCampusId && entry.entryType === 'payment');
    if (!payment) return null;
    const invoice = this.feeInvoices.find((entry) => entry.id === payment.invoiceId);
    const shift = await this.getActiveCashierShift(actor);
    if (!shift) throw feeConflict('Open a cashier shift before recording financial activity.');
    if (shift.currencyCode !== invoice.currencyCode) throw feeConflict('Payment currency must match the active cashier shift.');
    const reversed = this.feePayments.filter((entry) =>
      entry.entryType === 'reversal' && entry.reversesPaymentId === paymentId)
      .reduce((total, entry) => total + moneyCents(entry.amount), 0);
    if (moneyCents(data.amount) > moneyCents(payment.amount) - reversed) {
      throw feeConflict('Reversal exceeds the unreversed payment amount.');
    }
    const reversal = {
      id: randomUUID(), campusId: actor.activeCampusId, invoiceId: invoice.id,
      receiptNumber: null, entryType: 'reversal', reversesPaymentId: payment.id,
      amount: roundMoney(data.amount), method: payment.method, reason: data.reason,
      recordedBy: actor.sub, cashierShiftId: shift.id, currencyCode: invoice.currencyCode,
      recordedOn: addisDate(), recordedAt: now()
    };
    this.feePayments.push(reversal);
    const balance = feeInvoiceBalance(invoice, this.feePayments);
    invoice.status = moneyCents(balance) === 0 ? 'paid' :
      moneyCents(balance) === moneyCents(invoice.totalAmount) ? 'issued' : 'partially_paid';
    await this.appendAudit(actor, 'fee_payment.reversed', 'fee_payment', payment.id, null, {
      reversalId: reversal.id, amount: reversal.amount, reason: reversal.reason
    });
    return reversal;
  },
  async getFeeReceipt(campusId, receiptNumber) {
    const payment = this.feePayments.find((entry) =>
      entry.campusId === campusId && entry.receiptNumber === receiptNumber && entry.entryType === 'payment');
    if (!payment) return null;
    const invoice = this.feeInvoices.find((entry) => entry.id === payment.invoiceId);
    const student = this.students.find((entry) => entry.id === invoice.studentId);
    return {
      ...payment, currencyCode: invoice.currencyCode, invoiceNumber: invoice.invoiceNumber,
      studentId: invoice.studentId, invoiceTotal: invoice.totalAmount,
      studentNo: student?.studentNo ?? '', studentName: student ? `${student.givenNameEn} ${student.fatherNameEn}` : ''
    };
  }
};
