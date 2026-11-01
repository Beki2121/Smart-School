import { createAttendanceController } from '../controllers/attendance.controller.js';

const routeRegistrations = {
  getAttendance(app, context, controller) {
    app.get("/api/attendance", context.requirePermission('attendance.view'), controller.getAttendance);
  },
  getAttendanceSummary(app, context, controller) {
    app.get("/api/attendance/summary", context.requirePermission('attendance.view'), controller.getAttendanceSummary);
  },
  postAttendance(app, context, controller) {
    app.post("/api/attendance", context.requirePermission('attendance.take'), controller.postAttendance);
  },
  getAttendanceSessionsBySessionId(app, context, controller) {
    app.get("/api/attendance/sessions/:sessionId", context.requirePermission('attendance.view'), controller.getAttendanceSessionsBySessionId);
  },
  patchAttendanceSessionsBySessionIdRecordsByStudentId(app, context, controller) {
    app.patch("/api/attendance/sessions/:sessionId/records/:studentId", context.requirePermission('attendance.edit'), controller.patchAttendanceSessionsBySessionIdRecordsByStudentId);
  },
  getAttendanceCorrectionRequests(app, context, controller) {
    app.get("/api/attendance/correction-requests", context.requirePermission('attendance.corrections.review'), controller.getAttendanceCorrectionRequests);
  },
  patchAttendanceCorrectionRequestsByRequestId(app, context, controller) {
    app.patch("/api/attendance/correction-requests/:requestId", context.requirePermission('attendance.corrections.review'), controller.patchAttendanceCorrectionRequestsByRequestId);
  },
  getAttendanceSectionsBySectionIdRoster(app, context, controller) {
    app.get("/api/attendance/sections/:sectionId/roster", context.requirePermission('attendance.view'), controller.getAttendanceSectionsBySectionIdRoster);
  }
};

export function registerAttendanceRoutes(app, context, routeIds) {
  const controller = createAttendanceController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
