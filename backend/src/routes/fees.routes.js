import { createFeesController } from '../controllers/fees.controller.js';

const routeRegistrations = {
  getFeesItems(app, context, controller) {
    app.get("/api/fees/items", context.requirePermission('fees.view'), controller.getFeesItems);
  },
  getFeesShiftsCurrent(app, context, controller) {
    app.get("/api/fees/shifts/current", context.requirePermission('fees.shifts'), controller.getFeesShiftsCurrent);
  },
  getFeesShifts(app, context, controller) {
    app.get("/api/fees/shifts", context.requirePermission('fees.shifts'), controller.getFeesShifts);
  },
  postFeesShifts(app, context, controller) {
    app.post("/api/fees/shifts", context.requirePermission('fees.shifts'), controller.postFeesShifts);
  },
  postFeesShiftsByShiftIdClose(app, context, controller) {
    app.post("/api/fees/shifts/:shiftId/close", context.requirePermission('fees.shifts'), controller.postFeesShiftsByShiftIdClose);
  },
  getFeesExpenses(app, context, controller) {
    app.get("/api/fees/expenses", context.requirePermission('fees.expenses.view'), controller.getFeesExpenses);
  },
  postFeesExpenses(app, context, controller) {
    app.post("/api/fees/expenses", context.requirePermission('fees.expenses.manage'), controller.postFeesExpenses);
  },
  getFeesSummary(app, context, controller) {
    app.get("/api/fees/summary", context.requirePermission('fees.reports.view'), controller.getFeesSummary);
  },
  postFeesItems(app, context, controller) {
    app.post("/api/fees/items", context.requirePermission('fees.manage'), controller.postFeesItems);
  },
  putFeesItemsByItemId(app, context, controller) {
    app.put("/api/fees/items/:itemId", context.requirePermission('fees.manage'), controller.putFeesItemsByItemId);
  },
  getFeesInvoices(app, context, controller) {
    app.get("/api/fees/invoices", context.requirePermission('fees.view'), controller.getFeesInvoices);
  },
  postFeesInvoices(app, context, controller) {
    app.post("/api/fees/invoices", context.requirePermission('fees.manage'), controller.postFeesInvoices);
  },
  postFeesInvoicesByInvoiceIdVoid(app, context, controller) {
    app.post("/api/fees/invoices/:invoiceId/void", context.requirePermission('fees.manage'), controller.postFeesInvoicesByInvoiceIdVoid);
  },
  postFeesInvoicesByInvoiceIdPayments(app, context, controller) {
    app.post("/api/fees/invoices/:invoiceId/payments", context.requirePermission('fees.collect'), controller.postFeesInvoicesByInvoiceIdPayments);
  },
  postFeesPaymentsByPaymentIdReversals(app, context, controller) {
    app.post("/api/fees/payments/:paymentId/reversals", context.requirePermission('fees.reverse'), controller.postFeesPaymentsByPaymentIdReversals);
  },
  getFeesReceiptsByReceiptNumber(app, context, controller) {
    app.get("/api/fees/receipts/:receiptNumber", context.requirePermission('fees.view'), controller.getFeesReceiptsByReceiptNumber);
  }
};

export function registerFeesRoutes(app, context, routeIds) {
  const controller = createFeesController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
