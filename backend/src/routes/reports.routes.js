import { createReportsController } from '../controllers/reports.controller.js';

const reportPermissions = [
  'reports.students.view', 'reports.admissions.view', 'reports.attendance.view',
  'reports.academics.view', 'reports.finance.view', 'reports.hr.view',
  'reports.operations.view', 'payroll.reports.view'
];

const routes = {
  getReportsCatalog(app, context, controller) {
    app.get('/api/reports/catalog', context.requireAnyPermission(reportPermissions), controller.catalog);
  },
  getReportsFilters(app, context, controller) {
    app.get('/api/reports/filters', context.requireAnyPermission(reportPermissions), controller.filters);
  },
  getReportsByReportId(app, context, controller) {
    app.get('/api/reports/:reportId', context.requireAnyPermission(reportPermissions), controller.getReport);
  },
  getReportsByReportIdCsv(app, context, controller) {
    app.get('/api/reports/:reportId.csv', context.requireAnyPermission(reportPermissions), controller.exportReport);
  }
};

export function registerReportsRoutes(app, context, routeIds) {
  const controller = createReportsController(context);
  for (const routeId of routeIds) routes[routeId](app, context, controller);
}
