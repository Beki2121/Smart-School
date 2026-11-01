import { createAdmissionsController } from '../controllers/admissions.controller.js';

const routeRegistrations = {
  getAdmissionsDashboard(app, context, controller) {
    app.get("/api/admissions/dashboard", context.requirePermission('admissions.view'), controller.getAdmissionsDashboard);
  },
  getAdmissionsPublicLink(app, context, controller) {
    app.get("/api/admissions/public-link", context.requirePermission('admissions.manage'), controller.getAdmissionsPublicLink);
  },
  getAdmissionsDuplicates(app, context, controller) {
    app.get("/api/admissions/duplicates", context.requirePermission('admissions.view'), controller.getAdmissionsDuplicates);
  },
  getAdmissions(app, context, controller) {
    app.get("/api/admissions", context.requirePermission('admissions.view'), controller.getAdmissions);
  },
  postAdmissions(app, context, controller) {
    app.post("/api/admissions", context.requirePermission('admissions.manage'), controller.postAdmissions);
  },
  putAdmissionsStudentIdPattern(app, context, controller) {
    app.put("/api/admissions/student-id-pattern", context.requirePermission('admissions.manage'), controller.putAdmissionsStudentIdPattern);
  },
  postAdmissionsByadmissionIdInterview(app, context, controller) {
    app.post("/api/admissions/:admissionId/interview", context.requirePermission('admissions.manage'), controller.postAdmissionsByadmissionIdInterview);
  },
  patchAdmissionsByadmissionIdStatus(app, context, controller) {
    app.patch("/api/admissions/:admissionId/status", context.requirePermission('admissions.manage'), controller.patchAdmissionsByadmissionIdStatus);
  },
  postAdmissionsByadmissionIdEnrol(app, context, controller) {
    app.post("/api/admissions/:admissionId/enrol", context.requirePermission('admissions.manage'), controller.postAdmissionsByadmissionIdEnrol);
  },
  getAdmissionsByadmissionIdDocuments(app, context, controller) {
    app.get("/api/admissions/:admissionId/documents", context.requirePermission('admissions.view'), controller.getAdmissionsByadmissionIdDocuments);
  },
  postAdmissionsByadmissionIdDocuments(app, context, controller) {
    app.post("/api/admissions/:admissionId/documents", context.requirePermission('admissions.manage'), context.express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }), controller.postAdmissionsByadmissionIdDocuments);
  },
  getAdmissionsByadmissionIdDocumentsBydocumentId(app, context, controller) {
    app.get("/api/admissions/:admissionId/documents/:documentId", context.requirePermission('admissions.view'), controller.getAdmissionsByadmissionIdDocumentsBydocumentId);
  },
  getAdmissionsByadmissionIdOfferLetter(app, context, controller) {
    app.get("/api/admissions/:admissionId/offer-letter", context.requirePermission('admissions.view'), controller.getAdmissionsByadmissionIdOfferLetter);
  }
};

export function registerAdmissionsRoutes(app, context, routeIds) {
  const controller = createAdmissionsController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
