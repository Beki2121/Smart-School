import { createCurriculumController } from '../controllers/curriculum.controller.js';

const routeRegistrations = {
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
};

export function registerCurriculumRoutes(app, context, routeIds) {
  const controller = createCurriculumController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
