import { createExamsController } from '../controllers/exams.controller.js';

const registrations = {
  getExamTypes(app, context, controller) {
    app.get('/api/exam-types', context.requirePermission('exams.view'), controller.getExamTypes);
  },
  postExamTypes(app, context, controller) {
    app.post('/api/exam-types', context.requirePermission('exams.manage'), controller.postExamTypes);
  },
  patchExamTypesByExamTypeId(app, context, controller) {
    app.patch('/api/exam-types/:examTypeId', context.requirePermission('exams.manage'),
      controller.patchExamTypesByExamTypeId);
  },
  getExams(app, context, controller) {
    app.get('/api/exams', context.requirePermission('exams.view'), controller.getExams);
  },
  getExamsMonitoring(app, context, controller) {
    app.get('/api/exams/monitoring', context.requirePermission('exams.monitor'),
      controller.getExamsMonitoring);
  },
  postExams(app, context, controller) {
    app.post('/api/exams', context.requirePermission('exams.manage'), controller.postExams);
  },
  patchExamsByExamId(app, context, controller) {
    app.patch('/api/exams/:examId', context.requirePermission('exams.manage'),
      controller.patchExamsByExamId);
  },
  postExamsByExamIdSchedule(app, context, controller) {
    app.post('/api/exams/:examId/schedule', context.requirePermission('exams.schedule.manage'),
      controller.postExamsByExamIdSchedule);
  },
  putExamsByExamIdScheduleEntry(app, context, controller) {
    app.put('/api/exams/:examId/schedule/:entryId', context.requirePermission('exams.schedule.manage'),
      controller.putExamsByExamIdScheduleEntry);
  },
  postExamsByExamIdSchedulePublish(app, context, controller) {
    app.post('/api/exams/:examId/schedule/publish', context.requirePermission('exams.schedule.manage'),
      controller.postExamsByExamIdSchedulePublish);
  },
  postExamsByExamIdMarksOpen(app, context, controller) {
    app.post('/api/exams/:examId/marks/open', context.requirePermission('exams.schedule.manage'),
      controller.postExamsByExamIdMarksOpen);
  }
};

export function registerExamsRoutes(app, context, routeIds) {
  const controller = createExamsController(context);
  for (const routeId of routeIds) registrations[routeId](app, context, controller);
}
