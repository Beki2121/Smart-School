import { createPayrollController } from '../controllers/payroll.controller.js';

const routes = {
  dashboard(app, context, controller) {
    app.get('/api/payroll/dashboard', context.requirePermission('payroll.run.view'), controller.dashboard);
  },
  listRules(app, context, controller) {
    app.get('/api/payroll/rules', context.requirePermission('payroll.structures.view'), controller.listRules);
  },
  createRule(app, context, controller) {
    app.post('/api/payroll/rules', context.requirePermission('payroll.structures.manage'), controller.createRule);
  },
  listStructures(app, context, controller) {
    app.get('/api/payroll/structures', context.requirePermission('payroll.structures.view'), controller.listStructures);
  },
  createStructure(app, context, controller) {
    app.post('/api/payroll/structures', context.requirePermission('payroll.structures.manage'), controller.createStructure);
  },
  updateStructure(app, context, controller) {
    app.patch('/api/payroll/structures/:structureId', context.requirePermission('payroll.structures.manage'), controller.updateStructure);
  },
  listPeriods(app, context, controller) {
    app.get('/api/payroll/periods', context.requirePermission('payroll.run.view'), controller.listPeriods);
  },
  createPeriod(app, context, controller) {
    app.post('/api/payroll/periods', context.requirePermission('payroll.periods.manage'), controller.createPeriod);
  },
  openPeriod(app, context, controller) {
    app.post('/api/payroll/periods/:periodId/open', context.requirePermission('payroll.periods.manage'), controller.openPeriod);
  },
  listInputs(app, context, controller) {
    app.get('/api/payroll/periods/:periodId/inputs', context.requirePermission('payroll.run.view'), controller.listInputs);
  },
  loadInputs(app, context, controller) {
    app.post('/api/payroll/periods/:periodId/inputs/load', context.requirePermission('payroll.inputs.manage'), controller.loadInputs);
  },
  updateInput(app, context, controller) {
    app.put('/api/payroll/periods/:periodId/inputs/:staffId', context.requirePermission('payroll.inputs.manage'), controller.updateInput);
  },
  createAdjustment(app, context, controller) {
    app.post('/api/payroll/periods/:periodId/adjustments', context.requirePermission('payroll.inputs.manage'), controller.createAdjustment);
  },
  createRun(app, context, controller) {
    app.post('/api/payroll/periods/:periodId/runs', context.requirePermission('payroll.run.calculate'), controller.createRun);
  },
  calculateRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/calculate', context.requirePermission('payroll.run.calculate'), controller.calculateRun);
  },
  getRun(app, context, controller) {
    app.get('/api/payroll/runs/:runId', context.requirePermission('payroll.run.view'), controller.getRun);
  },
  submitRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/submit', context.requirePermission('payroll.run.submit'), controller.submitRun);
  },
  approveRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/approve', context.requirePermission('payroll.run.approve'), controller.approveRun);
  },
  rejectRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/reject', context.requirePermission('payroll.run.approve'), controller.rejectRun);
  },
  lockRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/lock', context.requirePermission('payroll.run.lock'), controller.lockRun);
  },
  payRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/payments', context.requirePermission('payroll.payments.manage'), controller.payRun);
  },
  generatePayslips(app, context, controller) {
    app.post('/api/payroll/runs/:runId/payslips', context.requirePermission('payroll.payslips.generate'), controller.generatePayslips);
  },
  listPayslips(app, context, controller) {
    app.get('/api/payroll/payslips', context.requirePermission('payroll.payslips.view'), controller.listPayslips);
  },
  getPayslip(app, context, controller) {
    app.get('/api/payroll/payslips/:payslipId', context.requirePermission('payroll.payslips.view'), controller.getPayslip);
  },
  closeRun(app, context, controller) {
    app.post('/api/payroll/runs/:runId/close', context.requirePermission('payroll.run.lock'), controller.closeRun);
  }
};

export function registerPayrollRoutes(app, context, routeIds) {
  const controller = createPayrollController(context);
  for (const routeId of routeIds) routes[routeId](app, context, controller);
}
