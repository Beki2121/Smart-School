import { createTimetableController } from '../controllers/timetable.controller.js';

const routeRegistrations = {
  getTimetablePeriods(app, context, controller) {
    app.get("/api/timetable/periods", context.requirePermission('staff.view'), controller.getTimetablePeriods);
  },
  postTimetablePeriods(app, context, controller) {
    app.post("/api/timetable/periods", context.requirePermission('assignments.manage'), controller.postTimetablePeriods);
  },
  getTimetableRooms(app, context, controller) {
    app.get("/api/timetable/rooms", context.requirePermission('staff.view'), controller.getTimetableRooms);
  },
  postTimetableRooms(app, context, controller) {
    app.post("/api/timetable/rooms", context.requirePermission('assignments.manage'), controller.postTimetableRooms);
  },
  getTimetable(app, context, controller) {
    app.get("/api/timetable", context.requirePermission('staff.view'), controller.getTimetable);
  },
  postTimetableAssignmentsByassignmentIdSubstitutions(app, context, controller) {
    app.post("/api/timetable/assignments/:assignmentId/substitutions", context.requirePermission('assignments.manage'), controller.postTimetableAssignmentsByassignmentIdSubstitutions);
  },
  putSectionsBysectionIdHomeroom(app, context, controller) {
    app.put("/api/sections/:sectionId/homeroom", context.requirePermission('assignments.manage'), controller.putSectionsBysectionIdHomeroom);
  },
};

export function registerTimetableRoutes(app, context, routeIds) {
  const controller = createTimetableController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
