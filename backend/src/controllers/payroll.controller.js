export function createPayrollController(context) {
  const { parse, repo, payrollRuleSchema, payrollSalaryStructureSchema,
    payrollSalaryStructureUpdateSchema,
    payrollPeriodSchema, payrollPeriodIdSchema, payrollRunIdSchema,
    payrollStructureIdSchema, payrollInputSchema, payrollRunSchema,
    payrollCalculateSchema, payrollDecisionSchema, payrollPaymentSchema,
    payrollAdjustmentSchema, payrollPayslipIdSchema, z } = context;
  const notFound = (response, code, message) =>
    response.status(404).json({ error: { code, message } });
  return {
    dashboard: async (request, response, next) => {
      try { response.set('Cache-Control', 'no-store').json({ data: await repo.getPayrollDashboard(request.user) }); }
      catch (error) { next(error); }
    },
    listRules: async (request, response, next) => {
      try { response.set('Cache-Control', 'no-store').json({ data: await repo.listPayrollRules(request.user) }); }
      catch (error) { next(error); }
    },
    createRule: async (request, response, next) => {
      try {
        const result = await repo.createPayrollRule(parse(payrollRuleSchema, request.body), request.user);
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listStructures: async (request, response, next) => {
      try {
        const staffId = request.query.staffId ? parse(z.string().uuid(), request.query.staffId) : undefined;
        response.set('Cache-Control', 'no-store')
          .json({ data: await repo.listPayrollSalaryStructures(request.user, staffId) });
      } catch (error) { next(error); }
    },
    createStructure: async (request, response, next) => {
      try {
        const result = await repo.createPayrollSalaryStructure(
          parse(payrollSalaryStructureSchema, request.body), request.user
        );
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    updateStructure: async (request, response, next) => {
      try {
        const structureId = parse(payrollStructureIdSchema, request.params.structureId);
        const result = await repo.updatePayrollSalaryStructure(
          structureId, parse(payrollSalaryStructureUpdateSchema, request.body), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_STRUCTURE_NOT_FOUND', 'Salary structure not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listPeriods: async (request, response, next) => {
      try { response.set('Cache-Control', 'no-store').json({ data: await repo.listPayrollPeriods(request.user) }); }
      catch (error) { next(error); }
    },
    createPeriod: async (request, response, next) => {
      try {
        const result = await repo.createPayrollPeriod(parse(payrollPeriodSchema, request.body), request.user);
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    openPeriod: async (request, response, next) => {
      try {
        const result = await repo.openPayrollPeriod(
          parse(payrollPeriodIdSchema, request.params.periodId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listInputs: async (request, response, next) => {
      try {
        const result = await repo.listPayrollInputs(
          parse(payrollPeriodIdSchema, request.params.periodId), request.user
        );
        if (result === null) return notFound(response, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    loadInputs: async (request, response, next) => {
      try {
        const result = await repo.loadPayrollInputs(
          parse(payrollPeriodIdSchema, request.params.periodId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    updateInput: async (request, response, next) => {
      try {
        const periodId = parse(payrollPeriodIdSchema, request.params.periodId);
        const staffId = parse(z.string().uuid(), request.params.staffId);
        const result = await repo.updatePayrollInput(
          periodId, staffId, parse(payrollInputSchema, request.body), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_INPUT_NOT_FOUND', 'Payroll input not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    createAdjustment: async (request, response, next) => {
      try {
        const result = await repo.createPayrollAdjustment(
          parse(payrollPeriodIdSchema, request.params.periodId),
          parse(payrollAdjustmentSchema, request.body), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found.');
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    createRun: async (request, response, next) => {
      try {
        const result = await repo.createPayrollRun(
          parse(payrollPeriodIdSchema, request.params.periodId),
          parse(payrollRunSchema, request.body).idempotencyKey, request.user
        );
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    calculateRun: async (request, response, next) => {
      try {
        const result = await repo.calculatePayrollRun(
          parse(payrollRunIdSchema, request.params.runId),
          parse(payrollCalculateSchema, request.body ?? {}), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    getRun: async (request, response, next) => {
      try {
        const result = await repo.getPayrollRun(
          parse(payrollRunIdSchema, request.params.runId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    submitRun: async (request, response, next) => {
      try {
        const result = await repo.submitPayrollRun(
          parse(payrollRunIdSchema, request.params.runId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    approveRun: async (request, response, next) => {
      try {
        const result = await repo.reviewPayrollRun(
          parse(payrollRunIdSchema, request.params.runId), 'approved',
          parse(payrollDecisionSchema, request.body).reason, request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    rejectRun: async (request, response, next) => {
      try {
        const result = await repo.reviewPayrollRun(
          parse(payrollRunIdSchema, request.params.runId), 'rejected',
          parse(payrollDecisionSchema, request.body).reason, request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    lockRun: async (request, response, next) => {
      try {
        const result = await repo.lockPayrollRun(
          parse(payrollRunIdSchema, request.params.runId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    payRun: async (request, response, next) => {
      try {
        const result = await repo.recordPayrollPayment(
          parse(payrollRunIdSchema, request.params.runId),
          parse(payrollPaymentSchema, request.body), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_LINE_NOT_FOUND', 'Payroll line not found.');
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    generatePayslips: async (request, response, next) => {
      try {
        const result = await repo.generatePayrollPayslips(
          parse(payrollRunIdSchema, request.params.runId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.status(201).set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    listPayslips: async (request, response, next) => {
      try {
        response.set('Cache-Control', 'no-store')
          .json({ data: await repo.listPayrollPayslips(request.user) });
      } catch (error) { next(error); }
    },
    getPayslip: async (request, response, next) => {
      try {
        const result = await repo.getPayrollPayslip(
          parse(payrollPayslipIdSchema, request.params.payslipId), request.user
        );
        if (!result) return notFound(response, 'PAYSLIP_NOT_FOUND', 'Payslip not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    },
    closeRun: async (request, response, next) => {
      try {
        const result = await repo.closePayrollRun(
          parse(payrollRunIdSchema, request.params.runId), request.user
        );
        if (!result) return notFound(response, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
        response.set('Cache-Control', 'no-store').json({ data: result });
      } catch (error) { next(error); }
    }
  };
}
