import { reportCatalog, reportsForPermissions } from '../reports/catalog.js';

function columnLabel(value) {
  return value.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function createReportsController(context) {
  const { parse, repo, reportIdSchema, reportQuerySchema, toCsv } = context;
  return {
    catalog: async (request, response, next) => {
      try {
        const permissions = await repo.getRolePermissions(request.user.orgId, request.user.role);
        const visible = new Set(reportsForPermissions(permissions)
          .filter((report) => report.roleScope.includes(request.user.role))
          .map((report) => report.id));
        response.json({ data: reportCatalog.filter((report) => visible.has(report.id)) });
      } catch (error) { next(error); }
    },
    filters: async (request, response, next) => {
      try { response.json({ data: await repo.getReportFilters(request.user) }); }
      catch (error) { next(error); }
    },
    getReport: async (request, response, next) => {
      try {
        const reportId = parse(reportIdSchema, request.params.reportId);
        const filters = parse(reportQuerySchema, request.query);
        response.json({ data: await repo.getReport(reportId, filters, request.user) });
      } catch (error) { next(error); }
    },
    exportReport: async (request, response, next) => {
      try {
        const reportId = parse(reportIdSchema, request.params.reportId);
        const filters = parse(reportQuerySchema, request.query);
        const result = await repo.getReport(reportId, filters, request.user, { exportCsv: true });
        const rows = result.rows.map((row) => result.columns.map((column) => row[column]));
        response.type('text/csv; charset=utf-8')
          .set('Content-Disposition', `attachment; filename="${reportId}.csv"`)
          .send(toCsv([[...result.columns.map(columnLabel)], ...rows]));
      } catch (error) { next(error); }
    }
  };
}
