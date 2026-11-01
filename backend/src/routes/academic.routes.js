import { createAcademicController } from '../controllers/academic.controller.js';

const routeRegistrations = {
  getSchoolCalendar(app, context, controller) {
    app.get("/api/school-calendar", context.requirePermission('school.view'), controller.getSchoolCalendar);
  },
  postSchoolCalendar(app, context, controller) {
    app.post("/api/school-calendar", context.requirePermission('school.edit'), controller.postSchoolCalendar);
  },
  putSchoolCalendarByentryId(app, context, controller) {
    app.put("/api/school-calendar/:entryId", context.requirePermission('school.edit'), controller.putSchoolCalendarByentryId);
  },
  deleteSchoolCalendarByentryId(app, context, controller) {
    app.delete("/api/school-calendar/:entryId", context.requirePermission('school.edit'), controller.deleteSchoolCalendarByentryId);
  },
  getAcademicYear(app, context, controller) {
    app.get("/api/academic-year", context.requirePermission('school.view'), controller.getAcademicYear);
  },
  getAcademicYears(app, context, controller) {
    app.get("/api/academic-years", context.requirePermission('school.view'), controller.getAcademicYears);
  },
  postAcademicYears(app, context, controller) {
    app.post("/api/academic-years", context.requirePermission('school.edit'), controller.postAcademicYears);
  },
  patchAcademicYearsByyearIdActivate(app, context, controller) {
    app.patch("/api/academic-years/:yearId/activate", context.requirePermission('school.edit'), controller.patchAcademicYearsByyearIdActivate);
  },
  getTerms(app, context, controller) {
    app.get("/api/terms", context.requirePermission('school.view'), controller.getTerms);
  },
  postTerms(app, context, controller) {
    app.post("/api/terms", context.requirePermission('school.edit'), controller.postTerms);
  },
  patchTermsBytermIdCurrent(app, context, controller) {
    app.patch("/api/terms/:termId/current", context.requirePermission('school.edit'), controller.patchTermsBytermIdCurrent);
  },
  getGrades(app, context, controller) {
    app.get("/api/grades", context.requirePermission('school.view'), controller.getGrades);
  },
  postGrades(app, context, controller) {
    app.post("/api/grades", context.requirePermission('school.edit'), controller.postGrades);
  },
  postSections(app, context, controller) {
    app.post("/api/sections", context.requirePermission('school.edit'), controller.postSections);
  },
  patchSectionsBysectionIdCapacity(app, context, controller) {
    app.patch("/api/sections/:sectionId/capacity", context.requirePermission('school.edit'), controller.patchSectionsBysectionIdCapacity);
  },
  getSections(app, context, controller) {
    app.get("/api/sections", context.requirePermission('attendance.view'), controller.getSections);
  }
};

export function registerAcademicRoutes(app, context, routeIds) {
  const controller = createAcademicController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
