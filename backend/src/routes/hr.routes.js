import { createHrController } from '../controllers/hr.controller.js';

const routes = {
  getHrDashboard(app, context, controller) {
    app.get('/api/hr/dashboard', context.requirePermission('hr.dashboard.view'),
      controller.getDashboard);
  },
  patchHrStaff(app, context, controller) {
    app.patch('/api/hr/staff/:staffId', context.requirePermission('hr.staff.manage'), controller.patchStaff);
  },
  archiveHrStaff(app, context, controller) {
    app.post('/api/hr/staff/:staffId/archive', context.requirePermission('hr.staff.archive'), controller.archiveStaff);
  },
  previewHrStaffImport(app, context, controller) {
    app.post('/api/hr/staff/import/preview', context.requirePermission('hr.staff.import'),
      context.express.text({ type: 'text/csv', limit: '1mb' }), controller.previewStaffImport);
  },
  commitHrStaffImport(app, context, controller) {
    app.post('/api/hr/staff/import/commit', context.requirePermission('hr.staff.import'),
      context.express.text({ type: 'text/csv', limit: '1mb' }), controller.commitStaffImport);
  },
  getHrStaffDocuments(app, context, controller) {
    app.get('/api/hr/staff/:staffId/documents', context.requirePermission('hr.documents.view'), controller.listStaffDocuments);
  },
  postHrStaffDocuments(app, context, controller) {
    app.post('/api/hr/staff/:staffId/documents', context.requirePermission('hr.documents.manage'),
      context.express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }),
      controller.uploadStaffDocument);
  },
  getHrStaffDocument(app, context, controller) {
    app.get('/api/hr/staff/:staffId/documents/:documentId',
      context.requirePermission('hr.documents.view'), controller.downloadStaffDocument);
  },
  getHrContracts(app, context, controller) {
    app.get('/api/hr/contracts', context.requirePermission('hr.contracts.view'), controller.listContracts);
  },
  postHrStaffContracts(app, context, controller) {
    app.post('/api/hr/staff/:staffId/contracts', context.requirePermission('hr.contracts.manage'),
      controller.createContract);
  },
  postHrContractsRenewal(app, context, controller) {
    app.post('/api/hr/contracts/:contractId/renewals', context.requirePermission('hr.contracts.manage'),
      controller.renewContract);
  },
  getHrContractRenewals(app, context, controller) {
    app.get('/api/hr/contracts/:contractId/renewals', context.requirePermission('hr.contracts.view'),
      controller.listContractRenewals);
  },
  getHrLeaveTypes(app, context, controller) {
    app.get('/api/hr/leave-types', context.requirePermission('hr.leave.view'), controller.listLeaveTypes);
  },
  postHrLeaveTypes(app, context, controller) {
    app.post('/api/hr/leave-types', context.requirePermission('hr.leave.configure'),
      controller.createLeaveType);
  },
  getHrLeaveBalances(app, context, controller) {
    app.get('/api/hr/leave-balances', context.requirePermission('hr.leave.view'),
      controller.listLeaveBalances);
  },
  postHrLeaveBalances(app, context, controller) {
    app.post('/api/hr/leave-balances', context.requirePermission('hr.leave.balance.manage'),
      controller.setLeaveBalance);
  },
  getHrVacancies(app, context, controller) {
    app.get('/api/hr/vacancies', context.requirePermission('hr.recruitment.view'), controller.listVacancies);
  },
  postHrVacancies(app, context, controller) {
    app.post('/api/hr/vacancies', context.requirePermission('hr.recruitment.manage'), controller.createVacancy);
  },
  getHrApplicants(app, context, controller) {
    app.get('/api/hr/applicants', context.requirePermission('hr.recruitment.view'), controller.listApplicants);
  },
  postHrVacancyApplicants(app, context, controller) {
    app.post('/api/hr/vacancies/:vacancyId/applicants',
      context.requirePermission('hr.recruitment.manage'), controller.createApplicant);
  },
  postHrApplicantInterviews(app, context, controller) {
    app.post('/api/hr/applicants/:applicantId/interviews',
      context.requirePermission('hr.recruitment.manage'), controller.scheduleInterview);
  },
  getHrApplicantInterviews(app, context, controller) {
    app.get('/api/hr/applicants/:applicantId/interviews',
      context.requirePermission('hr.recruitment.view'), controller.listInterviews);
  },
  patchHrApplicantDecision(app, context, controller) {
    app.patch('/api/hr/applicants/:applicantId/decision',
      context.requirePermission('hr.recruitment.manage'), controller.decideApplicant);
  },
  postHrApplicantDocuments(app, context, controller) {
    app.post('/api/hr/applicants/:applicantId/documents',
      context.requirePermission('hr.recruitment.manage'),
      context.express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }),
      controller.uploadApplicantDocument);
  },
  getHrApplicantDocuments(app, context, controller) {
    app.get('/api/hr/applicants/:applicantId/documents',
      context.requirePermission('hr.recruitment.view'), controller.listApplicantDocuments);
  },
  getHrApplicantDocument(app, context, controller) {
    app.get('/api/hr/applicants/:applicantId/documents/:documentId',
      context.requirePermission('hr.recruitment.view'), controller.downloadApplicantDocument);
  },
  postHrPerformanceCycles(app, context, controller) {
    app.post('/api/hr/performance/cycles', context.requirePermission('hr.performance.manage'),
      controller.createPerformanceCycle);
  },
  getHrPerformanceCycles(app, context, controller) {
    app.get('/api/hr/performance/cycles', context.requirePermission('hr.performance.view'),
      controller.listPerformanceCycles);
  },
  postHrPerformanceGoals(app, context, controller) {
    app.post('/api/hr/performance/goals', context.requirePermission('hr.performance.manage'),
      controller.createPerformanceGoal);
  },
  getHrPerformanceGoals(app, context, controller) {
    app.get('/api/hr/performance/goals', context.requirePermission('hr.performance.view'),
      controller.listPerformanceGoals);
  },
  postHrPerformanceEvaluations(app, context, controller) {
    app.post('/api/hr/performance/evaluations', context.requirePermission('hr.performance.manage'),
      controller.createPerformanceEvaluation);
  },
  getHrPerformanceEvaluations(app, context, controller) {
    app.get('/api/hr/performance/evaluations', context.requirePermission('hr.performance.view'),
      controller.listPerformanceEvaluations);
  },
  postHrTrainingCourses(app, context, controller) {
    app.post('/api/hr/training/courses', context.requirePermission('hr.training.manage'),
      controller.createTrainingCourse);
  },
  getHrTrainingCourses(app, context, controller) {
    app.get('/api/hr/training/courses', context.requirePermission('hr.training.view'),
      controller.listTrainingCourses);
  },
  postHrTrainingEnrollments(app, context, controller) {
    app.post('/api/hr/training/courses/:courseId/enrollments',
      context.requirePermission('hr.training.manage'), controller.enrollTraining);
  },
  getHrTrainingEnrollments(app, context, controller) {
    app.get('/api/hr/training/courses/:courseId/enrollments',
      context.requirePermission('hr.training.view'), controller.listTrainingEnrollments);
  },
  patchHrTrainingEnrollmentAttendance(app, context, controller) {
    app.patch('/api/hr/training/enrollments/:enrollmentId/attendance',
      context.requirePermission('hr.training.manage'), controller.updateTrainingAttendance);
  },
  putHrTrainingEnrollmentCertificate(app, context, controller) {
    app.put('/api/hr/training/enrollments/:enrollmentId/certificate',
      context.requirePermission('hr.training.manage'),
      context.express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }),
      controller.uploadTrainingCertificate);
  },
  getHrTrainingEnrollmentCertificate(app, context, controller) {
    app.get('/api/hr/training/enrollments/:enrollmentId/certificate',
      context.requirePermission('hr.training.view'), controller.downloadTrainingCertificate);
  }
};

export function registerHrRoutes(app, context, routeIds) {
  const controller = createHrController(context);
  for (const routeId of routeIds) routes[routeId](app, context, controller);
}
