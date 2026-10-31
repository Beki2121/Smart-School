import { createStudentsController } from '../controllers/students.controller.js';

const routeRegistrations = {
  postStudentsByStudentIdWithdraw(app, context, controller) {
    app.post("/api/students/:studentId/withdraw", context.requirePermission('admissions.manage'), controller.postStudentsByStudentIdWithdraw);
  },
  postStudentsByStudentIdReadmit(app, context, controller) {
    app.post("/api/students/:studentId/readmit", context.requirePermission('admissions.manage'), controller.postStudentsByStudentIdReadmit);
  },
  postStudentsByStudentIdTransferOut(app, context, controller) {
    app.post("/api/students/:studentId/transfer-out", context.requirePermission('admissions.manage'), controller.postStudentsByStudentIdTransferOut);
  },
  getStudentsByStudentIdEnrolments(app, context, controller) {
    app.get("/api/students/:studentId/enrolments", context.requirePermission('students.view'), controller.getStudentsByStudentIdEnrolments);
  },
  postStudentsByStudentIdSectionTransfer(app, context, controller) {
    app.post("/api/students/:studentId/section-transfer", context.requirePermission('admissions.manage'), controller.postStudentsByStudentIdSectionTransfer);
  },
  getStudentsByStudentIdSectionTransfers(app, context, controller) {
    app.get("/api/students/:studentId/section-transfers", context.requirePermission('students.view'), controller.getStudentsByStudentIdSectionTransfers);
  },
  postStudentsByStudentIdProgression(app, context, controller) {
    app.post("/api/students/:studentId/progression", context.requirePermission('admissions.manage'), controller.postStudentsByStudentIdProgression);
  },
  getStudentsByStudentIdProgressionEligibility(app, context, controller) {
    app.get("/api/students/:studentId/progression-eligibility", context.requirePermission('admissions.view'), controller.getStudentsByStudentIdProgressionEligibility);
  },
  getStudentsByStudentIdTransferCertificate(app, context, controller) {
    app.get("/api/students/:studentId/transfer-certificate", context.requirePermission('admissions.view'), controller.getStudentsByStudentIdTransferCertificate);
  },
  getStudents(app, context, controller) {
    app.get("/api/students", context.requirePermission('students.view'), controller.getStudents);
  },
  getAlumni(app, context, controller) {
    app.get("/api/alumni", context.requirePermission('students.alumni.view'), controller.getAlumni);
  },
  postStudentsImportPreview(app, context, controller) {
    app.post("/api/students/import/preview", context.requirePermission('students.edit'), context.express.text({ type: 'text/csv', limit: '1mb' }), controller.postStudentsImportPreview);
  },
  postStudentsImportCommit(app, context, controller) {
    app.post("/api/students/import/commit", context.requirePermission('students.edit'), context.express.text({ type: 'text/csv', limit: '1mb' }), controller.postStudentsImportCommit);
  },
  postStudents(app, context, controller) {
    app.post("/api/students", context.requirePermission('students.edit'), controller.postStudents);
  },
  getStudentsByStudentId(app, context, controller) {
    app.get("/api/students/:studentId", context.requirePermission('students.view'), controller.getStudentsByStudentId);
  },
  getStudentsByStudentIdSensitiveData(app, context, controller) {
    app.get("/api/students/:studentId/sensitive-data", context.requirePermission('students.sensitive.view'), controller.getStudentsByStudentIdSensitiveData);
  },
  putStudentsByStudentIdSensitiveData(app, context, controller) {
    app.put("/api/students/:studentId/sensitive-data", context.requirePermission('students.sensitive.manage'), controller.putStudentsByStudentIdSensitiveData);
  },
  patchStudentsByStudentIdProfile(app, context, controller) {
    app.patch("/api/students/:studentId/profile", context.requirePermission('students.edit'), controller.patchStudentsByStudentIdProfile);
  },
  getStudentsByStudentIdDocuments(app, context, controller) {
    app.get("/api/students/:studentId/documents", context.requirePermission('students.view'), controller.getStudentsByStudentIdDocuments);
  },
  getStudentsByStudentIdTransferPackages(app, context, controller) {
    app.get("/api/students/:studentId/transfer-packages", context.requirePermission('admissions.view'), controller.getStudentsByStudentIdTransferPackages);
  },
  postStudentsByStudentIdTransferPackages(app, context, controller) {
    app.post("/api/students/:studentId/transfer-packages", context.requirePermission('admissions.manage'), controller.postStudentsByStudentIdTransferPackages);
  },
  postStudentsByStudentIdTransferPackagesByPackageIdApprove(app, context, controller) {
    app.post("/api/students/:studentId/transfer-packages/:packageId/approve", context.requirePermission('students.transfer.approve'), controller.postStudentsByStudentIdTransferPackagesByPackageIdApprove);
  },
  postStudentsByStudentIdDocuments(app, context, controller) {
    app.post("/api/students/:studentId/documents", context.requirePermission('students.edit'), context.express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }), controller.postStudentsByStudentIdDocuments);
  },
  getStudentsByStudentIdDocumentsByDocumentId(app, context, controller) {
    app.get("/api/students/:studentId/documents/:documentId", context.requirePermission('students.view'), controller.getStudentsByStudentIdDocumentsByDocumentId);
  },
  getStudentsByStudentIdEmergencyContacts(app, context, controller) {
    app.get("/api/students/:studentId/emergency-contacts", context.requirePermission('students.emergency.view'), controller.getStudentsByStudentIdEmergencyContacts);
  },
  postStudentsByStudentIdEmergencyContacts(app, context, controller) {
    app.post("/api/students/:studentId/emergency-contacts", context.requirePermission('students.emergency.manage'), controller.postStudentsByStudentIdEmergencyContacts);
  },
  deleteStudentsByStudentIdEmergencyContactsByContactId(app, context, controller) {
    app.delete("/api/students/:studentId/emergency-contacts/:contactId", context.requirePermission('students.emergency.manage'), controller.deleteStudentsByStudentIdEmergencyContactsByContactId);
  },
  getStudentsByStudentIdGuardians(app, context, controller) {
    app.get("/api/students/:studentId/guardians", context.requirePermission('students.guardians.view'), controller.getStudentsByStudentIdGuardians);
  },
  postStudentsByStudentIdGuardians(app, context, controller) {
    app.post("/api/students/:studentId/guardians", context.requirePermission('students.guardians.manage'), controller.postStudentsByStudentIdGuardians);
  },
  patchStudentsByStudentIdGuardiansByGuardianIdAccess(app, context, controller) {
    app.patch("/api/students/:studentId/guardians/:guardianId/access", context.requirePermission('students.guardians.manage'), controller.patchStudentsByStudentIdGuardiansByGuardianIdAccess);
  },
  deleteStudentsByStudentIdGuardiansByGuardianId(app, context, controller) {
    app.delete("/api/students/:studentId/guardians/:guardianId", context.requirePermission('students.guardians.manage'), controller.deleteStudentsByStudentIdGuardiansByGuardianId);
  },
  getStudentsByStudentIdDiscipline(app, context, controller) {
    app.get("/api/students/:studentId/discipline", context.requirePermission('students.discipline.view'), controller.getStudentsByStudentIdDiscipline);
  },
  postStudentsByStudentIdDiscipline(app, context, controller) {
    app.post("/api/students/:studentId/discipline", context.requirePermission('students.discipline.manage'), controller.postStudentsByStudentIdDiscipline);
  },
  getStudentsByStudentIdCommendations(app, context, controller) {
    app.get("/api/students/:studentId/commendations", context.requirePermission('students.commendations.view'), controller.getStudentsByStudentIdCommendations);
  },
  postStudentsByStudentIdCommendations(app, context, controller) {
    app.post("/api/students/:studentId/commendations", context.requirePermission('students.commendations.manage'), controller.postStudentsByStudentIdCommendations);
  }
};

export function registerStudentsRoutes(app, context, routeIds) {
  const controller = createStudentsController(context);
  for (const routeId of routeIds) routeRegistrations[routeId](app, context, controller);
}
