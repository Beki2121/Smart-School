import { createAssignmentsController } from '../controllers/assignments.controller.js';

export function registerAssignmentsRoutes(app, context, routeIds) {
  const controller = createAssignmentsController(context);
  const manage = context.requirePermission('assignments.manage');
  const portalBase = '/api/portal/assignments';
  const rawUpload = context.express.raw({ type: () => true, limit: '5mb' });
  const registrations = {
    listAssignments() {
      app.get('/api/assignments', context.requireAnyPermission([
        'assignments.manage', 'assignments.view'
      ]), controller.listAssignments);
    },
    getAssignmentSubmissions() {
      app.get('/api/assignments/:assignmentId/submissions', manage,
        controller.getAssignmentSubmissions);
    },
    postAssignment() {
      app.post('/api/assignments', manage, controller.postAssignment);
    },
    patchAssignment() {
      app.patch('/api/assignments/:assignmentId', manage, controller.patchAssignment);
    },
    transitionAssignment() {
      app.post('/api/assignments/:assignmentId/status', manage, controller.transitionAssignment);
    },
    uploadAssignmentAttachment() {
      app.post('/api/assignments/:assignmentId/attachments', manage, rawUpload,
        controller.uploadAssignmentAttachment);
    },
    portalAssignments() {
      app.get(portalBase, context.requireAnyPermission([
        'assignments.submit', 'assignments.view_child'
      ]), controller.portalAssignments);
    },
    submitAssignment() {
      app.put(`${portalBase}/:assignmentId/submission`,
        context.requirePermission('assignments.submit'), controller.submitAssignment);
    },
    uploadSubmissionAttachment() {
      app.post(`${portalBase}/:assignmentId/attachments`, context.requirePermission('assignments.submit'),
        rawUpload, controller.uploadSubmissionAttachment);
    },
    gradeSubmission() {
      app.patch('/api/assignments/:assignmentId/submissions/:submissionId/grade', manage,
        controller.gradeSubmission);
    },
    downloadAssignmentAttachment() {
      app.get('/api/assignments/attachments/:attachmentId', context.requireAnyPermission([
        'assignments.manage', 'assignments.view'
      ]), controller.downloadAssignmentAttachment);
    },
    downloadPortalAssignmentAttachment() {
      app.get('/api/portal/assignment-attachments/:attachmentId', context.requireAnyPermission([
        'assignments.submit', 'assignments.view_child'
      ]), controller.downloadPortalAssignmentAttachment);
    }
  };
  for (const routeId of routeIds) registrations[routeId]();
}
