import { createAssessmentsController } from '../controllers/assessments.controller.js';

const routeRegistrations = {
  getMarks(app, context, controller) {
    app.get("/api/marks", context.requirePermission('marks.view'), controller.getMarks);
  },
  getMarksContext(app, context, controller) {
    app.get("/api/marks/context", context.requirePermission('marks.view'), controller.getMarksContext);
  },
  getMarksSummary(app, context, controller) {
    app.get("/api/marks/summary", context.requirePermission('marks.view'), controller.getMarksSummary);
  },
  postMarks(app, context, controller) {
    app.post("/api/marks", context.requirePermission('marks.enter'), controller.postMarks);
  },
  postMarksByMarkIdSubmit(app, context, controller) {
    app.post("/api/marks/:markId/submit", context.requirePermission('marks.enter'), controller.postMarksByMarkIdSubmit);
  },
  postMarksByMarkIdApprove(app, context, controller) {
    app.post("/api/marks/:markId/approve", context.requirePermission('marks.approve'), controller.postMarksByMarkIdApprove);
  },
  postMarksByMarkIdPublish(app, context, controller) {
    app.post("/api/marks/:markId/publish", context.requirePermission('marks.publish'), controller.postMarksByMarkIdPublish);
  },
  postMarksByMarkIdAmend(app, context, controller) {
    app.post("/api/marks/:markId/amend", context.requirePermission('marks.amend'), controller.postMarksByMarkIdAmend);
  },
  getMarksStudentsByStudentId(app, context, controller) {
    app.get("/api/marks/students/:studentId", context.requirePermission('marks.view'), controller.getMarksStudentsByStudentId);
  },
  getGradingBands(app, context, controller) {
    app.get("/api/grading/bands", context.requirePermission('marks.view'), controller.getGradingBands);
  },
  putGradingBands(app, context, controller) {
    app.put("/api/grading/bands", context.requirePermission('school.edit'), controller.putGradingBands);
  },
  getGradingPolicy(app, context, controller) {
    app.get("/api/grading/policy", context.requirePermission('marks.view'), controller.getGradingPolicy);
  },
  putGradingPolicy(app, context, controller) {
    app.put("/api/grading/policy", context.requirePermission('school.edit'), controller.putGradingPolicy);
  },
  getReportCardsStudentsByStudentId(app, context, controller) {
    app.get("/api/report-cards/students/:studentId", context.requirePermission('marks.view'), controller.getReportCardsStudentsByStudentId);
  },
  postReportCardsStudentsByStudentIdDrafts(app, context, controller) {
    app.post("/api/report-cards/students/:studentId/drafts", context.requirePermission('marks.approve'), controller.postReportCardsStudentsByStudentIdDrafts);
  },
  postReportCardsByReportIdSubmit(app, context, controller) {
    app.post("/api/report-cards/:reportId/submit", context.requirePermission('marks.approve'), controller.postReportCardsByReportIdSubmit);
  },
  postReportCardsByReportIdApprove(app, context, controller) {
    app.post("/api/report-cards/:reportId/approve", context.requirePermission('marks.approve'), controller.postReportCardsByReportIdApprove);
  },
  postReportCardsByReportIdPublish(app, context, controller) {
    app.post("/api/report-cards/:reportId/publish", context.requirePermission('marks.publish'), controller.postReportCardsByReportIdPublish);
  }
};

export function registerAssessmentsRoutes(app, context, routeIds) {
  const controller = createAssessmentsController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
