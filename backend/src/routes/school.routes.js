import { createSchoolController } from '../controllers/school.controller.js';

const routeRegistrations = {
  getDashboard(app, context, controller) {
    app.get("/api/dashboard", context.requirePermission('dashboard.view'), controller.getDashboard);
  },
  getPortalHome(app, context, controller) {
    app.get("/api/portal/home", context.requirePermission('portal.view'), controller.getPortalHome);
  },
  getSchool(app, context, controller) {
    app.get("/api/school", context.requirePermission('school.view'), controller.getSchool);
  },
  getSchoolSettings(app, context, controller) {
    app.get("/api/school/settings", context.requirePermission('school.view'), controller.getSchoolSettings);
  },
  putSchoolSettings(app, context, controller) {
    app.put("/api/school/settings", context.requirePermission('school.edit'), controller.putSchoolSettings);
  },
  getSchoolSubscription(app, context, controller) {
    app.get("/api/school/subscription", context.requirePermission('school.view'), controller.getSchoolSubscription);
  },
  postSchoolClosure(app, context, controller) {
    app.post("/api/school/closure", context.requirePermission('school.close'), controller.postSchoolClosure);
  },
  getSchoolExport(app, context, controller) {
    app.get("/api/school/export", context.requirePermission('school.export'), controller.getSchoolExport);
  },
  putSchool(app, context, controller) {
    app.put("/api/school", context.requirePermission('school.edit'), controller.putSchool);
  }
};

export function registerSchoolRoutes(app, context, routeIds) {
  const controller = createSchoolController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
