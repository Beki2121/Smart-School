import { createStaffController } from '../controllers/staff.controller.js';

const routeRegistrations = {
  getDepartments(app, context, controller) {
    app.get("/api/departments", context.requirePermission('staff.view'), controller.getDepartments);
  },
  postDepartments(app, context, controller) {
    app.post("/api/departments", context.requirePermission('staff.manage'), controller.postDepartments);
  },
  getStaff(app, context, controller) {
    app.get("/api/staff", context.requirePermission('staff.view'), controller.getStaff);
  },
  postStaff(app, context, controller) {
    app.post("/api/staff", context.requirePermission('staff.manage'), controller.postStaff);
  },
  getTeachingAssignments(app, context, controller) {
    app.get("/api/teaching-assignments", context.requirePermission('staff.view'), controller.getTeachingAssignments);
  },
  postTeachingAssignments(app, context, controller) {
    app.post("/api/teaching-assignments", context.requirePermission('assignments.manage'), controller.postTeachingAssignments);
  },
  getStaffAttendance(app, context, controller) {
    app.get("/api/staff/attendance", context.requirePermission('staff.attendance'), controller.getStaffAttendance);
  },
  postStaffAttendance(app, context, controller) {
    app.post("/api/staff/attendance", context.requirePermission('staff.attendance'), controller.postStaffAttendance);
  },
  getStaffAttendanceCsv(app, context, controller) {
    app.get("/api/staff/attendance.csv", context.requirePermission('staff.manage'), controller.getStaffAttendanceCsv);
  },
  getLeaveRequests(app, context, controller) {
    app.get("/api/leave-requests", context.requirePermission('leave.request'), controller.getLeaveRequests);
  },
  postLeaveRequests(app, context, controller) {
    app.post("/api/leave-requests", context.requirePermission('leave.request'), controller.postLeaveRequests);
  },
  patchLeaveRequestsByLeaveId(app, context, controller) {
    app.patch("/api/leave-requests/:leaveId", context.requirePermission('leave.approve'), controller.patchLeaveRequestsByLeaveId);
  },
  getStaffMessages(app, context, controller) {
    app.get("/api/staff/messages", context.requirePermission('staff.messages'), controller.getStaffMessages);
  },
  postStaffMessages(app, context, controller) {
    app.post("/api/staff/messages", context.requirePermission('staff.manage'), controller.postStaffMessages);
  }
};

export function registerStaffRoutes(app, context, routeIds) {
  const controller = createStaffController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
