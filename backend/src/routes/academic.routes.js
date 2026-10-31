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
  getCurriculumGrades(app, context, controller) {
    app.get("/api/curriculum/grades", context.requirePermission('school.view'), controller.getCurriculumGrades);
  },
  getCurriculumUnits(app, context, controller) {
    app.get("/api/curriculum/units", context.requirePermission('school.view'), controller.getCurriculumUnits);
  },
  postCurriculumUnits(app, context, controller) {
    app.post("/api/curriculum/units", context.requirePermission('school.edit'), controller.postCurriculumUnits);
  },
  putCurriculumUnitsByunitId(app, context, controller) {
    app.put("/api/curriculum/units/:unitId", context.requirePermission('school.edit'), controller.putCurriculumUnitsByunitId);
  },
  deleteCurriculumUnitsByunitId(app, context, controller) {
    app.delete("/api/curriculum/units/:unitId", context.requirePermission('school.edit'), controller.deleteCurriculumUnitsByunitId);
  },
  postGrades(app, context, controller) {
    app.post("/api/grades", context.requirePermission('school.edit'), controller.postGrades);
  },
  getGradesBygradeIdSubjects(app, context, controller) {
    app.get("/api/grades/:gradeId/subjects", context.requirePermission('school.view'), controller.getGradesBygradeIdSubjects);
  },
  putGradesBygradeIdSubjects(app, context, controller) {
    app.put("/api/grades/:gradeId/subjects", context.requirePermission('school.edit'), controller.putGradesBygradeIdSubjects);
  },
  getSubjects(app, context, controller) {
    app.get("/api/subjects", context.requirePermission('school.view'), controller.getSubjects);
  },
  postSubjects(app, context, controller) {
    app.post("/api/subjects", context.requirePermission('school.edit'), controller.postSubjects);
  },
  getPromotionRules(app, context, controller) {
    app.get("/api/promotion-rules", context.requirePermission('school.view'), controller.getPromotionRules);
  },
  putGradesBygradeIdPromotionRule(app, context, controller) {
    app.put("/api/grades/:gradeId/promotion-rule", context.requirePermission('school.edit'), controller.putGradesBygradeIdPromotionRule);
  },
  getLessonPlans(app, context, controller) {
    app.get("/api/lesson-plans", context.requirePermission('lesson_plans.view'), controller.getLessonPlans);
  },
  postLessonPlans(app, context, controller) {
    app.post("/api/lesson-plans", context.requirePermission('lesson_plans.manage'), controller.postLessonPlans);
  },
  putLessonPlansBylessonPlanId(app, context, controller) {
    app.put("/api/lesson-plans/:lessonPlanId", context.requirePermission('lesson_plans.manage'), controller.putLessonPlansBylessonPlanId);
  },
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
