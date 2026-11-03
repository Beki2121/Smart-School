function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function csv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function sendCsv(response, filename, headers, rows) {
  response.type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .send(csv([headers, ...rows]));
}

function amountToMinorUnits(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? 0));
  if (!match) throw new TypeError('Finance report amount is not a decimal value.');
  const [, sign, whole, fraction = ''] = match;
  let amountMinor = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  if (fraction[2] >= '5') amountMinor += 1n;
  return Number(sign === '-' ? -amountMinor : amountMinor);
}

function reportAmounts(rows) {
  const amounts = new Map();
  for (const row of rows) {
    const currencyCode = row.currencyCode ?? '';
    const cents = amountToMinorUnits(row.amount);
    amounts.set(currencyCode, (amounts.get(currencyCode) ?? 0) + cents);
  }
  return [...amounts].map(([currencyCode, amountMinor]) => ({
    currencyCode, amount: amountMinor / 100
  }));
}

export function createFinanceController(context) {
  const { parse, repo, z } = context;
  return {
    listStructures: async (request, response, next) => {
      try { response.json({ data: await repo.listFeeStructures(request.user) }); }
      catch (error) { next(error); }
    },
    createStructure: async (request, response, next) => {
      try {
        const structure = await repo.createFeeStructure(parse(context.feeStructureSchema, request.body), request.user);
        response.status(201).json({ data: structure });
      } catch (error) { next(error); }
    },
    previewStructureInvoices: async (request, response, next) => {
      try {
        const structureId = parse(z.string().uuid(), request.params.structureId);
        const query = parse(context.feeStructurePreviewSchema, request.query);
        const preview = await repo.previewFeeStructureInvoices(structureId, query.sectionId, request.user);
        if (!preview) return response.status(404).json({ error: {
          code: 'FEE_STRUCTURE_NOT_FOUND', message: 'Fee structure not found.'
        } });
        response.json({ data: preview });
      } catch (error) { next(error); }
    },
    generateStructureInvoices: async (request, response, next) => {
      try {
        const structureId = parse(z.string().uuid(), request.params.structureId);
        const body = parse(context.feeStructureGenerateSchema, request.body);
        const result = await repo.generateFeeStructureInvoices(
          structureId, body.sectionId, body.idempotencyKey, request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'FEE_STRUCTURE_NOT_FOUND', message: 'Fee structure not found.'
        } });
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    listDiscountTypes: async (request, response, next) => {
      try { response.json({ data: await repo.listFeeDiscountTypes(request.user) }); }
      catch (error) { next(error); }
    },
    createDiscountType: async (request, response, next) => {
      try {
        const result = await repo.createFeeDiscountType(
          parse(context.feeDiscountTypeSchema, request.body), request.user);
        response.status(201).json({ data: result });
      } catch (error) { next(error); }
    },
    listDiscountRequests: async (request, response, next) => {
      try { response.json({ data: await repo.listFeeDiscountRequests(request.user) }); }
      catch (error) { next(error); }
    },
    requestDiscount: async (request, response, next) => {
      try {
        const result = await repo.requestFeeDiscount(
          parse(context.feeDiscountRequestSchema, request.body), request.user);
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    transitionDiscount: async (request, response, next) => {
      try {
        const requestId = parse(z.string().uuid(), request.params.requestId);
        const { status } = parse(context.feeApprovalSchema, request.body);
        const result = await repo.transitionFeeDiscount(requestId, status, request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'FEE_DISCOUNT_NOT_FOUND', message: 'Discount request not found.'
        } });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    listRefundRequests: async (request, response, next) => {
      try { response.json({ data: await repo.listFeeRefundRequests(request.user) }); }
      catch (error) { next(error); }
    },
    requestRefund: async (request, response, next) => {
      try {
        const result = await repo.requestFeeRefund(
          parse(context.feeRefundRequestSchema, request.body), request.user);
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    transitionRefund: async (request, response, next) => {
      try {
        const requestId = parse(z.string().uuid(), request.params.requestId);
        const { status } = parse(z.object({ status: z.enum(['approved', 'rejected']) }), request.body);
        const result = await repo.transitionFeeRefund(requestId, status, request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'FEE_REFUND_NOT_FOUND', message: 'Refund request not found.'
        } });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    listAdjustmentRequests: async (request, response, next) => {
      try { response.json({ data: await repo.listFeeAdjustmentRequests(request.user) }); }
      catch (error) { next(error); }
    },
    requestAdjustment: async (request, response, next) => {
      try {
        const result = await repo.requestFeeAdjustment(
          parse(context.feeAdjustmentRequestSchema, request.body), request.user);
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    transitionAdjustment: async (request, response, next) => {
      try {
        const requestId = parse(z.string().uuid(), request.params.requestId);
        const { status } = parse(z.object({ status: z.enum(['approved', 'rejected']) }), request.body);
        const result = await repo.transitionFeeAdjustment(requestId, status, request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'FEE_ADJUSTMENT_NOT_FOUND', message: 'Adjustment request not found.'
        } });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    getArrears: async (request, response, next) => {
      try {
        const { asOf } = parse(context.feeArrearsQuerySchema, request.query);
        response.json({ data: await repo.getArrearsReport(asOf, request.user) });
      } catch (error) { next(error); }
    },
    exportArrears: async (request, response, next) => {
      try {
        const { asOf } = parse(context.feeArrearsQuerySchema, request.query);
        const rows = await repo.getArrearsReport(asOf, request.user);
        sendCsv(response, 'fee-arrears.csv',
          ['Invoice', 'Student No', 'Student', 'Class', 'Due date', 'Days overdue', 'Bucket', 'Balance', 'Currency'],
          rows.map((row) => [row.invoiceNumber, row.studentNo, row.studentName, row.sectionName,
            row.dueDate, row.daysOverdue, row.bucket, row.balanceDue, row.currencyCode]));
      } catch (error) { next(error); }
    },
    createArrearsFollowup: async (request, response, next) => {
      try {
        const invoiceId = parse(z.string().uuid(), request.params.invoiceId);
        const result = await repo.createArrearsFollowup(
          invoiceId, parse(context.feeArrearsFollowupSchema, request.body), request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'INVOICE_NOT_FOUND', message: 'Outstanding invoice not found.'
        } });
        response.status(201).json({ data: result });
      } catch (error) { next(error); }
    },
    getStatement: async (request, response, next) => {
      try {
        const { studentId } = parse(context.feeStudentStatementParamsSchema, request.params);
        response.json({ data: await repo.getStudentFeeStatement(studentId, request.user) });
      } catch (error) { next(error); }
    },
    getPortalInvoices: async (request, response, next) => {
      try { response.json({ data: await repo.listFeeInvoices(request.user) }); }
      catch (error) { next(error); }
    },
    getReport: async (request, response, next) => {
      try {
        const query = parse(context.feeReportQuerySchema, request.query);
        const sourceRows = await repo.getFeeReport(query.type, query.from, query.to, request.user);
        const rows = sourceRows.map((row) => ({
          ...row,
          date: row.date ?? row.recordedOn,
          amount: row.entryType === 'reversal'
            ? -Math.abs(row.amount ?? (row.amountMinor === undefined ? 0 : row.amountMinor / 100))
            : row.amount ?? (row.amountMinor === undefined ? 0 : row.amountMinor / 100),
          currencyCode: row.currencyCode ?? ''
        }));
        const totalsByCurrency = reportAmounts(rows);
        if (request.query.format === 'csv') {
          sendCsv(response, `finance-${query.type}.csv`,
            ['Date', 'Invoice', 'Student', 'Class', 'Fee types', 'Category', 'Description',
              'Amount', 'Currency', 'Entry', 'Method'],
            [...rows.map((row) => [row.date, row.invoiceNumber, row.studentName, row.className,
              row.feeTypes, row.category, row.description, row.amount, row.currencyCode,
              row.entryType, row.method]),
            ...totalsByCurrency.map((total) => [
              'TOTAL', '', '', '', '', '', '', total.amount, total.currencyCode, '', ''
            ])]);
          return;
        }
        response.json({ data: { ...query, rows, totalsByCurrency } });
      } catch (error) { next(error); }
    },
    getDashboard: async (request, response, next) => {
      try { response.json({ data: await repo.getFinanceDashboard(request.user) }); }
      catch (error) { next(error); }
    },
    listCashbookAccounts: async (request, response, next) => {
      try { response.json({ data: await repo.listCashbookAccounts(request.user) }); }
      catch (error) { next(error); }
    },
    createCashbookAccount: async (request, response, next) => {
      try {
        const result = await repo.createCashbookAccount(
          parse(context.cashbookAccountSchema, request.body), request.user);
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    createCashbookDeposit: async (request, response, next) => {
      try {
        const accountId = parse(z.string().uuid(), request.params.accountId);
        const result = await repo.createCashbookDeposit(
          accountId, parse(context.cashbookDepositSchema, request.body), request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'CASHBOOK_ACCOUNT_NOT_FOUND', message: 'Cashbook account not found.'
        } });
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    transferCashbookFunds: async (request, response, next) => {
      try {
        const result = await repo.transferCashbookFunds(
          parse(context.cashbookTransferSchema, request.body), request.user);
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    listCashbookEntries: async (request, response, next) => {
      try {
        const query = parse(context.cashbookEntryQuerySchema, request.query);
        const result = await repo.listCashbookEntries(
          query.accountId, query.from, query.to, request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'CASHBOOK_ACCOUNT_NOT_FOUND', message: 'Cashbook account not found.'
        } });
        response.json({ data: result });
      } catch (error) { next(error); }
    },
    reconcileCashbookAccount: async (request, response, next) => {
      try {
        const accountId = parse(z.string().uuid(), request.params.accountId);
        const result = await repo.reconcileCashbookAccount(
          accountId, parse(context.cashbookReconciliationSchema, request.body), request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'CASHBOOK_ACCOUNT_NOT_FOUND', message: 'Cashbook account not found.'
        } });
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    },
    reverseCashbookEntry: async (request, response, next) => {
      try {
        const entryId = parse(z.string().uuid(), request.params.entryId);
        const result = await repo.reverseCashbookEntry(
          entryId, parse(context.cashbookReverseSchema, request.body), request.user);
        if (!result) return response.status(404).json({ error: {
          code: 'CASHBOOK_ENTRY_NOT_FOUND', message: 'Cashbook entry not found.'
        } });
        response.status(result.duplicate ? 200 : 201).json({ data: result });
      } catch (error) { next(error); }
    }
  };
}
