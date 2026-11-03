import { createFinanceController } from '../controllers/finance.controller.js';

const registrations = {
  getFeeStructures(app, context, controller) {
    app.get('/api/fees/structures', context.requirePermission('fees.structure.manage'), controller.listStructures);
  },
  postFeeStructures(app, context, controller) {
    app.post('/api/fees/structures', context.requirePermission('fees.structure.manage'), controller.createStructure);
  },
  getFeeStructuresByStructureIdPreview(app, context, controller) {
    app.get('/api/fees/structures/:structureId/preview', context.requirePermission('fees.structure.manage'),
      controller.previewStructureInvoices);
  },
  postFeeStructuresByStructureIdGenerate(app, context, controller) {
    app.post('/api/fees/structures/:structureId/generate', context.requirePermission('fees.structure.manage'),
      controller.generateStructureInvoices);
  },
  getFeeDiscountTypes(app, context, controller) {
    app.get('/api/fees/discount-types', context.requirePermission('fees.discount.request'),
      controller.listDiscountTypes);
  },
  postFeeDiscountTypes(app, context, controller) {
    app.post('/api/fees/discount-types', context.requirePermission('fees.discount.request'),
      controller.createDiscountType);
  },
  getFeeDiscountRequests(app, context, controller) {
    app.get('/api/fees/discount-requests', context.requirePermission('fees.reports.view'),
      controller.listDiscountRequests);
  },
  postFeeDiscountRequests(app, context, controller) {
    app.post('/api/fees/discount-requests', context.requirePermission('fees.discount.request'),
      controller.requestDiscount);
  },
  patchFeeDiscountRequestsByRequestId(app, context, controller) {
    app.patch('/api/fees/discount-requests/:requestId', context.requirePermission('fees.discount.approve'),
      controller.transitionDiscount);
  },
  getFeeRefundRequests(app, context, controller) {
    app.get('/api/fees/refund-requests', context.requirePermission('fees.reports.view'),
      controller.listRefundRequests);
  },
  postFeeRefundRequests(app, context, controller) {
    app.post('/api/fees/refund-requests', context.requirePermission('fees.refund.request'),
      controller.requestRefund);
  },
  patchFeeRefundRequestsByRequestId(app, context, controller) {
    app.patch('/api/fees/refund-requests/:requestId', context.requirePermission('fees.refund.approve'),
      controller.transitionRefund);
  },
  getFeeAdjustmentRequests(app, context, controller) {
    app.get('/api/fees/adjustment-requests', context.requirePermission('fees.reports.view'),
      controller.listAdjustmentRequests);
  },
  postFeeAdjustmentRequests(app, context, controller) {
    app.post('/api/fees/adjustment-requests', context.requirePermission('fees.adjustment.request'),
      controller.requestAdjustment);
  },
  patchFeeAdjustmentRequestsByRequestId(app, context, controller) {
    app.patch('/api/fees/adjustment-requests/:requestId', context.requirePermission('fees.adjustment.approve'),
      controller.transitionAdjustment);
  },
  getFeeArrears(app, context, controller) {
    app.get('/api/fees/arrears', context.requirePermission('fees.arrears.view'), controller.getArrears);
  },
  getFeeArrearsCsv(app, context, controller) {
    app.get('/api/fees/arrears.csv', context.requirePermission('fees.arrears.view'), controller.exportArrears);
  },
  postFeeInvoicesByInvoiceIdFollowups(app, context, controller) {
    app.post('/api/fees/invoices/:invoiceId/followups', context.requirePermission('fees.arrears.view'),
      controller.createArrearsFollowup);
  },
  getFeeStudentStatement(app, context, controller) {
    app.get('/api/fees/students/:studentId/statement', context.requirePermission('fees.reports.view'),
      controller.getStatement);
  },
  getFeePortalInvoices(app, context, controller) {
    app.get('/api/fees/portal/invoices', context.requirePermission('fees.portal.view'),
      controller.getPortalInvoices);
  },
  getFeePortalStudentStatement(app, context, controller) {
    app.get('/api/fees/portal/students/:studentId/statement', context.requirePermission('fees.portal.view'),
      controller.getStatement);
  },
  getFeeReports(app, context, controller) {
    app.get('/api/fees/reports', context.requirePermission('fees.reports.view'), controller.getReport);
  },
  getFeeDashboard(app, context, controller) {
    app.get('/api/fees/dashboard', context.requirePermission('fees.reports.view'), controller.getDashboard);
  },
  getCashbookAccounts(app, context, controller) {
    app.get('/api/fees/cashbook/accounts', context.requirePermission('fees.cashbook.manage'),
      controller.listCashbookAccounts);
  },
  postCashbookAccounts(app, context, controller) {
    app.post('/api/fees/cashbook/accounts', context.requirePermission('fees.cashbook.manage'),
      controller.createCashbookAccount);
  },
  postCashbookAccountsByAccountIdDeposits(app, context, controller) {
    app.post('/api/fees/cashbook/accounts/:accountId/deposits', context.requirePermission('fees.cashbook.manage'),
      controller.createCashbookDeposit);
  },
  postCashbookTransfers(app, context, controller) {
    app.post('/api/fees/cashbook/transfers', context.requirePermission('fees.cashbook.manage'),
      controller.transferCashbookFunds);
  },
  getCashbookEntries(app, context, controller) {
    app.get('/api/fees/cashbook/entries', context.requirePermission('fees.cashbook.manage'),
      controller.listCashbookEntries);
  },
  postCashbookAccountsByAccountIdReconciliations(app, context, controller) {
    app.post('/api/fees/cashbook/accounts/:accountId/reconciliations',
      context.requirePermission('fees.cashbook.manage'), controller.reconcileCashbookAccount);
  },
  postCashbookEntriesByEntryIdReversals(app, context, controller) {
    app.post('/api/fees/cashbook/entries/:entryId/reversals',
      context.requirePermission('fees.cashbook.manage'), controller.reverseCashbookEntry);
  }
};

export function registerFinanceRoutes(app, context, routeIds) {
  const controller = createFinanceController(context);
  for (const routeId of routeIds) registrations[routeId](app, context, controller);
}
