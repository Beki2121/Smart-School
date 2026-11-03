export function createFeesController(context) {
  const { cashierShiftCloseSchema, cashierShiftOpenSchema, feeExpenseSchema, feeItemSchema, feeItemUpdateSchema, feePaymentSchema, feeReportRangeSchema, feeReversalSchema, invoiceSchema, invoiceVoidSchema, parse, repo, z } = context;
  return {
    getFeesItems: async (request, response, next) => {
    try { response.json({ data: await repo.listFeeItems(request.user) }); }
    catch (error) { next(error); }
  },
    getFeesShiftsCurrent: async (request, response, next) => {
    try { response.json({ data: await repo.getActiveCashierShift(request.user) }); }
    catch (error) { next(error); }
  },
    getFeesShifts: async (request, response, next) => {
    try { response.json({ data: await repo.listCashierShifts(request.user) }); }
    catch (error) { next(error); }
  },
    postFeesShifts: async (request, response, next) => {
    try {
      const shift = await repo.openCashierShift(parse(cashierShiftOpenSchema, request.body), request.user);
      response.status(201).json({ data: shift });
    } catch (error) { next(error); }
  },
    postFeesShiftsByShiftIdClose: async (request, response, next) => {
    try {
      const shiftId = parse(z.string().uuid(), request.params.shiftId);
      const shift = await repo.closeCashierShift(shiftId, parse(cashierShiftCloseSchema, request.body), request.user);
      if (!shift) return response.status(404).json({ error: { code: 'SHIFT_NOT_FOUND', message: 'Open cashier shift not found.' } });
      response.json({ data: shift });
    } catch (error) { next(error); }
  },
    getFeesExpenses: async (request, response, next) => {
    try {
      const range = parse(feeReportRangeSchema, { from: request.query.from, to: request.query.to });
      response.json({ data: await repo.listFeeExpenses(
        request.user.activeCampusId, range.from, range.to, request.user) });
    } catch (error) { next(error); }
  },
    postFeesExpenses: async (request, response, next) => {
    try {
      const expense = await repo.createFeeExpense(parse(feeExpenseSchema, request.body), request.user);
      response.status(201).json({ data: expense });
    } catch (error) { next(error); }
  },
    getFeesSummary: async (request, response, next) => {
    try {
      const range = parse(feeReportRangeSchema, { from: request.query.from, to: request.query.to });
      const totals = await repo.getFeeSummary(
        request.user.activeCampusId, range.from, range.to, request.user);
      response.json({ data: { ...range, totals } });
    } catch (error) { next(error); }
  },
    postFeesItems: async (request, response, next) => {
    try {
      const item = await repo.createFeeItem(parse(feeItemSchema, request.body), request.user);
      response.status(201).json({ data: item });
    } catch (error) { next(error); }
  },
    putFeesItemsByItemId: async (request, response, next) => {
    try {
      const itemId = parse(z.string().uuid(), request.params.itemId);
      const item = await repo.updateFeeItem(itemId, parse(feeItemUpdateSchema, request.body), request.user);
      if (!item) return response.status(404).json({ error: { code: 'FEE_ITEM_NOT_FOUND', message: 'Fee item not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  },
    getFeesInvoices: async (request, response, next) => {
    try {
      const studentId = request.query.studentId == null ? undefined : parse(z.string().uuid(), request.query.studentId);
      response.json({ data: await repo.listFeeInvoices(request.user, studentId) });
    } catch (error) { next(error); }
  },
    postFeesInvoices: async (request, response, next) => {
    try {
      const invoice = await repo.createFeeInvoice(parse(invoiceSchema, request.body), request.user);
      response.status(201).json({ data: invoice });
    } catch (error) { next(error); }
  },
    postFeesInvoicesByInvoiceIdVoid: async (request, response, next) => {
    try {
      const invoiceId = parse(z.string().uuid(), request.params.invoiceId);
      const invoice = await repo.voidFeeInvoice(invoiceId, parse(invoiceVoidSchema, request.body), request.user);
      if (!invoice) return response.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' } });
      response.json({ data: invoice });
    } catch (error) { next(error); }
  },
    postFeesInvoicesByInvoiceIdPayments: async (request, response, next) => {
    try {
      const invoiceId = parse(z.string().uuid(), request.params.invoiceId);
      const payment = await repo.recordFeePayment(invoiceId, parse(feePaymentSchema, request.body), request.user);
      if (!payment) return response.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' } });
      response.status(payment.duplicate ? 200 : 201).json({ data: payment });
    } catch (error) { next(error); }
  },
    postFeesPaymentsByPaymentIdReversals: async (request, response, next) => {
    try {
      const paymentId = parse(z.string().uuid(), request.params.paymentId);
      const reversal = await repo.reverseFeePayment(paymentId, parse(feeReversalSchema, request.body), request.user);
      if (!reversal) return response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' } });
      response.status(201).json({ data: reversal });
    } catch (error) { next(error); }
  },
    getFeesReceiptsByReceiptNumber: async (request, response, next) => {
    try {
      const receiptNumber = parse(z.string().regex(/^RCP-[A-F0-9]{12}$/), request.params.receiptNumber);
      const receipt = await repo.getFeeReceipt(request.user, receiptNumber);
      if (!receipt) return response.status(404).json({ error: { code: 'RECEIPT_NOT_FOUND', message: 'Receipt not found.' } });
      response.json({ data: receipt });
    } catch (error) { next(error); }
  }
  };
}
