export function mapFeeItem(row) {
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId, code: row.code,
    nameEn: row.name_en ?? row.nameEn, nameAm: row.name_am ?? row.nameAm,
    amount: roundMoney(Number(row.amount)), currencyCode: row.currency_code ?? row.currencyCode,
    isActive: Boolean(row.is_active ?? row.isActive)
  };
}

export function mapCashierShift(row) {
  const openedAt = row.opened_at ?? row.openedAt;
  const closedAt = row.closed_at ?? row.closedAt ?? null;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    openedBy: row.opened_by ?? row.openedBy, closedBy: row.closed_by ?? row.closedBy ?? null,
    currencyCode: row.currency_code ?? row.currencyCode,
    openingFloat: roundMoney(Number(row.opening_float ?? row.openingFloat)),
    closingCash: row.closing_cash == null && row.closingCash == null
      ? null : roundMoney(Number(row.closing_cash ?? row.closingCash)),
    expectedCash: row.expected_cash == null && row.expectedCash == null
      ? null : roundMoney(Number(row.expected_cash ?? row.expectedCash)),
    variance: row.variance == null ? null : roundMoney(Number(row.variance)),
    status: row.status, recordedOn: row.recorded_on ?? row.recordedOn,
    openedAt: openedAt instanceof Date ? openedAt.toISOString() : openedAt,
    closedAt: closedAt instanceof Date ? closedAt.toISOString() : closedAt
  };
}

export function mapFeeExpense(row) {
  const recordedAt = row.recorded_at ?? row.recordedAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    cashierShiftId: row.cashier_shift_id ?? row.cashierShiftId,
    category: row.category, description: row.description,
    amount: roundMoney(Number(row.amount)), currencyCode: row.currency_code ?? row.currencyCode,
    method: row.method, reference: row.reference ?? null,
    recordedBy: row.recorded_by ?? row.recordedBy, recordedOn: row.recorded_on ?? row.recordedOn,
    recordedAt: recordedAt instanceof Date ? recordedAt.toISOString() : recordedAt
  };
}

export function mapFeePayment(row, invoice = {}) {
  const recordedAt = row.recorded_at ?? row.recordedAt;
  return {
    id: row.id, campusId: row.campus_id ?? row.campusId,
    invoiceId: row.invoice_id ?? row.invoiceId,
    receiptNumber: row.receipt_number ?? row.receiptNumber ?? null,
    entryType: row.entry_type ?? row.entryType,
    reversesPaymentId: row.reverses_payment_id ?? row.reversesPaymentId ?? null,
    cashierShiftId: row.cashier_shift_id ?? row.cashierShiftId ?? null,
    amount: roundMoney(Number(row.amount)), method: row.method,
    reference: row.reference ?? null, reason: row.reason ?? null,
    recordedBy: row.recorded_by ?? row.recordedBy,
    recordedOn: row.recorded_on ?? row.recordedOn ?? null,
    recordedAt: recordedAt instanceof Date ? recordedAt.toISOString() : recordedAt,
    ...invoice
  };
}

export function feeBalanceFromLedger(totalAmount, ledger) {
  const paid = ledger.reduce((total, entry) =>
    total + (entry.entry_type === 'reversal' ? -moneyCents(Number(entry.amount)) : moneyCents(Number(entry.amount))), 0);
  return roundMoney((moneyCents(totalAmount) - paid) / 100);
}

export function feeInvoiceBalance(invoice, payments) {
  return feeBalanceFromLedger(invoice.totalAmount, payments.filter((payment) =>
    payment.invoiceId === invoice.id).map((payment) => ({
    entry_type: payment.entryType, amount: payment.amount
  })));
}

export function feeInvoiceView(invoice, payments) {
  const invoicePayments = payments.filter((payment) => payment.invoiceId === invoice.id)
    .map((payment) => mapFeePayment(payment, { currencyCode: invoice.currencyCode }));
  const balanceDue = feeInvoiceBalance(invoice, payments);
  return {
    ...invoice, paidAmount: roundMoney(invoice.totalAmount - balanceDue),
    balanceDue, payments: invoicePayments
  };
}

export function moneyCents(value) {
  return Math.round((value + Number.EPSILON) * 100);
}

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
