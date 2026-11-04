import { authenticate } from '../middleware/authentication.js';
import { moduleForApiPath } from '../middleware/module-access.js';
import { registerPublicRoutes } from './public.routes.js';
import { registerSchoolRoutes } from './school.routes.js';
import { registerAcademicRoutes } from './academic.routes.js';
import { registerCurriculumRoutes } from './curriculum.routes.js';
import { registerTimetableRoutes } from './timetable.routes.js';
import { registerAdmissionsRoutes } from './admissions.routes.js';
import { registerStudentsRoutes } from './students.routes.js';
import { registerStaffRoutes } from './staff.routes.js';
import { registerCommunicationsRoutes } from './communications.routes.js';
import { registerAttendanceRoutes } from './attendance.routes.js';
import { registerFeesRoutes } from './fees.routes.js';
import { registerFinanceRoutes } from './finance.routes.js';
import { registerAssessmentsRoutes } from './assessments.routes.js';
import { registerExamsRoutes } from './exams.routes.js';
import { registerAssignmentsRoutes } from './assignments.routes.js';
import { registerReportsRoutes } from './reports.routes.js';
import { registerAuthenticatedAuthRoutes, registerPublicAuthRoutes } from './auth.routes.js';
import { registerAccountInvitationRoute, registerAccountRoutes } from './accounts.routes.js';
import { registerPlatformLicenceRoutes, registerPlatformRoutes } from './platform.routes.js';
import { registerAuditRoutes } from './audit.routes.js';
import { registerRoleRoutes } from './roles.routes.js';
import { registerPortalExtensionsRoutes } from './portal-extensions.routes.js';
import { registerHrRoutes } from './hr.routes.js';
import { registerPayrollRoutes } from './payroll.routes.js';
import { registerLibraryRoutes } from './library.routes.js';
import { registerInventoryRoutes } from './inventory.routes.js';
import { registerFrontDeskRoutes } from './front-desk.routes.js';

export function registerApplicationRoutes(app, routeContext, { repo, config, mailer, parse, requirePermission }) {
  registerPublicRoutes(app, routeContext, ["getHealth"]);

  registerPublicRoutes(app, routeContext, ["getPublicAdmissionsBytoken"]);
  registerPublicRoutes(app, routeContext, ["postPublicAdmissionsBytoken"]);
  registerPublicRoutes(app, routeContext, ["getPublicStudentTransfersBytoken"]);

  registerPublicAuthRoutes(app, { repo, config, mailer, parse });

  const authenticationGuard = authenticate(config, repo);
  authenticationGuard.authenticatesUser = true;
  app.use('/api', authenticationGuard, async (request, response, next) => {
    if (request.user.mustChangePassword &&
      !((request.method === 'GET' && request.path === '/auth/me') ||
        (request.method === 'POST' && ['/auth/password/change', '/auth/logout'].includes(request.path)))) {
      return response.status(403).json({
        error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password before continuing.' }
      });
    }
    if (request.user.role !== 'super_admin') {
      const requiredModule = moduleForApiPath(request.path);
      if (requiredModule) {
        try {
          if (!await repo.isModuleEnabled(request.user.orgId, requiredModule)) {
            return response.status(403).json({
              error: {
                code: 'MODULE_NOT_IN_PLAN',
                message: 'This module is not included in the school subscription plan.'
              }
            });
          }
        } catch (error) { return next(error); }
      }
    }
    next();
  });
  registerAcademicRoutes(app, routeContext, ["getSchoolCalendar"]);
  registerAcademicRoutes(app, routeContext, ["postSchoolCalendar"]);
  registerAcademicRoutes(app, routeContext, ["putSchoolCalendarByentryId"]);
  registerAcademicRoutes(app, routeContext, ["deleteSchoolCalendarByentryId"]);
  registerAuthenticatedAuthRoutes(app, { repo, config, parse, requirePermission });
  registerAuditRoutes(app, { repo, parse, requirePermission });
  registerReportsRoutes(app, routeContext, [
    'getReportsCatalog', 'getReportsFilters', 'getReportsByReportIdCsv', 'getReportsByReportId'
  ]);
  registerAccountRoutes(app, { repo, parse, requirePermission });
  registerRoleRoutes(app, { repo, config, parse, requirePermission });
  registerSchoolRoutes(app, routeContext, ["getDashboard"]);
  registerSchoolRoutes(app, routeContext, ["getPortalHome"]);
  registerPortalExtensionsRoutes(app, routeContext, ['getPortalCalendar', 'getPortalRequests',
    'postPortalRequests', 'patchPortalRequestStatus', 'getPortalSupportRequests',
    'postPortalSupportRequests', 'patchPortalSupportRequest', 'getPortalMessageThreads',
    'postPortalMessageThread', 'postPortalThreadMessage', 'patchPortalThreadRead',
    'patchPortalMessageModeration', 'getSchoolMessagingSettings', 'putSchoolMessagingSettings']);
  registerHrRoutes(app, routeContext, ['patchHrStaff', 'archiveHrStaff', 'previewHrStaffImport',
    'commitHrStaffImport', 'getHrStaffDocuments', 'postHrStaffDocuments', 'getHrStaffDocument',
    'getHrDashboard',
    'getHrContracts', 'postHrStaffContracts', 'postHrContractsRenewal',
    'getHrContractRenewals', 'getHrLeaveTypes', 'postHrLeaveTypes',
    'getHrLeaveBalances', 'postHrLeaveBalances', 'getHrVacancies', 'postHrVacancies',
    'getHrApplicants', 'postHrVacancyApplicants', 'postHrApplicantInterviews',
    'getHrApplicantInterviews', 'patchHrApplicantDecision', 'postHrApplicantDocuments',
    'getHrApplicantDocuments', 'getHrApplicantDocument',
    'postHrPerformanceCycles', 'getHrPerformanceCycles', 'postHrPerformanceGoals',
    'getHrPerformanceGoals', 'postHrPerformanceEvaluations', 'getHrPerformanceEvaluations',
    'postHrTrainingCourses',
    'getHrTrainingCourses', 'postHrTrainingEnrollments',
    'getHrTrainingEnrollments', 'patchHrTrainingEnrollmentAttendance', 'putHrTrainingEnrollmentCertificate',
    'getHrTrainingEnrollmentCertificate']);
  registerPayrollRoutes(app, routeContext, [
    'dashboard', 'listRules', 'createRule', 'listStructures', 'createStructure', 'updateStructure',
    'listPeriods', 'createPeriod', 'openPeriod', 'listInputs', 'loadInputs', 'updateInput',
    'createAdjustment', 'createRun', 'calculateRun', 'getRun', 'submitRun', 'approveRun',
    'rejectRun', 'lockRun', 'payRun', 'generatePayslips', 'listPayslips', 'getPayslip',
    'closeRun'
  ]);
  registerLibraryRoutes(app, routeContext, [
    'categories', 'createCategory', 'updateCategory', 'books', 'createBook', 'updateBook',
    'archiveBook', 'copies', 'copyByBarcode', 'createCopy', 'updateCopy', 'archiveCopy',
    'members', 'addMember', 'settings', 'updateSettings', 'dashboard', 'loans', 'issue',
    'returnLoan', 'renewLoan', 'reservations', 'reserve', 'cancelReservation', 'fines',
    'payFine', 'waiveFine', 'portal'
  ]);
  registerInventoryRoutes(app, routeContext, [
    'categories', 'createCategory', 'suppliers', 'createSupplier', 'items', 'createItem',
  'updateItem', 'archiveItem', 'purchases', 'createPurchase', 'updatePurchase',
  'purchaseStatus', 'receivePurchase', 'movements', 'createMovement', 'dashboard',
  'assets', 'createAsset', 'updateAsset', 'archiveAsset', 'assetStatus', 'allocations',
  'allocateAsset', 'returnAsset', 'maintenance', 'addMaintenance', 'ownAssets'
  ]);
  registerFrontDeskRoutes(app, routeContext, [
    'visitors', 'createVisitor', 'checkoutVisitor', 'appointments', 'createAppointment',
    'appointmentStatus', 'messages', 'createMessage', 'messageStatus', 'authorizations',
    'createAuthorization', 'authorizationStatus', 'pickupReleases', 'pickupAttempts',
    'releasePickup', 'correctPickup', 'deliveries', 'createDelivery', 'deliveryStatus',
    'lostFound', 'createLostFound', 'lostFoundStatus', 'dashboard', 'settings', 'updateSettings'
  ]);

  registerPlatformRoutes(app, { repo, config, parse, requirePermission });
  registerAccountInvitationRoute(app, { repo, config, parse, requirePermission });
  registerPlatformLicenceRoutes(app, { requirePermission });
  registerSchoolRoutes(app, routeContext, ["getSchool"]);
  registerSchoolRoutes(app, routeContext, ["getSchoolSettings"]);
  registerSchoolRoutes(app, routeContext, ["putSchoolSettings"]);
  registerSchoolRoutes(app, routeContext, ["getSchoolSubscription"]);
  registerSchoolRoutes(app, routeContext, ["postSchoolClosure"]);
  registerSchoolRoutes(app, routeContext, ["getSchoolExport"]);
  registerAcademicRoutes(app, routeContext, ["getAcademicYear"]);
  registerAcademicRoutes(app, routeContext, ["getAcademicYears"]);
  registerAcademicRoutes(app, routeContext, ["postAcademicYears"]);
  registerAcademicRoutes(app, routeContext, ["patchAcademicYearsByyearIdActivate"]);
  registerAcademicRoutes(app, routeContext, ["getTerms"]);
  registerAcademicRoutes(app, routeContext, ["postTerms"]);
  registerAcademicRoutes(app, routeContext, ["patchTermsBytermIdCurrent"]);
  registerAcademicRoutes(app, routeContext, ["getGrades"]);
  registerCurriculumRoutes(app, routeContext, ["getCurriculumGrades"]);
  registerCurriculumRoutes(app, routeContext, ["getCurriculumUnits"]);
  registerCurriculumRoutes(app, routeContext, ["postCurriculumUnits"]);
  registerCurriculumRoutes(app, routeContext, ["putCurriculumUnitsByunitId"]);
  registerCurriculumRoutes(app, routeContext, ["deleteCurriculumUnitsByunitId"]);
  registerAcademicRoutes(app, routeContext, ["postGrades"]);
  registerCurriculumRoutes(app, routeContext, ["getGradesBygradeIdSubjects"]);
  registerCurriculumRoutes(app, routeContext, ["putGradesBygradeIdSubjects"]);
  registerCurriculumRoutes(app, routeContext, ["getSubjects"]);
  registerCurriculumRoutes(app, routeContext, ["postSubjects"]);
  registerCurriculumRoutes(app, routeContext, ["getPromotionRules"]);
  registerCurriculumRoutes(app, routeContext, ["putGradesBygradeIdPromotionRule"]);
  registerStaffRoutes(app, routeContext, ["getDepartments"]);
  registerStaffRoutes(app, routeContext, ["postDepartments"]);
  registerStaffRoutes(app, routeContext, ["getStaff"]);
  registerStaffRoutes(app, routeContext, ["postStaff"]);
  registerStaffRoutes(app, routeContext, ["getTeachingAssignments"]);
  registerStaffRoutes(app, routeContext, ["postTeachingAssignments"]);
  registerCurriculumRoutes(app, routeContext, ["getLessonPlans"]);
  registerCurriculumRoutes(app, routeContext, ["postLessonPlans"]);
  registerCurriculumRoutes(app, routeContext, ["putLessonPlansBylessonPlanId"]);
  registerTimetableRoutes(app, routeContext, ["getTimetablePeriods"]);
  registerTimetableRoutes(app, routeContext, ["postTimetablePeriods"]);
  registerTimetableRoutes(app, routeContext, ["getTimetableRooms"]);
  registerTimetableRoutes(app, routeContext, ["postTimetableRooms"]);
  registerTimetableRoutes(app, routeContext, ["getTimetable"]);
  registerTimetableRoutes(app, routeContext, ["postTimetableAssignmentsByassignmentIdSubstitutions"]);
  registerTimetableRoutes(app, routeContext, ["putSectionsBysectionIdHomeroom"]);
  registerStaffRoutes(app, routeContext, ["getStaffAttendance"]);
  registerStaffRoutes(app, routeContext, ["postStaffAttendance"]);
  registerStaffRoutes(app, routeContext, ["getStaffAttendanceCsv"]);
  registerStaffRoutes(app, routeContext, ["getLeaveRequests"]);
  registerStaffRoutes(app, routeContext, ["postLeaveRequests"]);
  registerStaffRoutes(app, routeContext, ["patchLeaveRequestsByLeaveId"]);
  registerStaffRoutes(app, routeContext, ["getStaffMessages"]);
  registerStaffRoutes(app, routeContext, ["postStaffMessages"]);
  registerCommunicationsRoutes(app, routeContext, ["getCommunicationsAnnouncements"]);
  registerCommunicationsRoutes(app, routeContext, ["postCommunicationsAnnouncements"]);
  registerCommunicationsRoutes(app, routeContext, ["getCommunicationsEvents"]);
  registerCommunicationsRoutes(app, routeContext, ["postCommunicationsEvents"]);
  registerPortalExtensionsRoutes(app, routeContext, ['patchCommunicationsEventStatus']);
  registerCommunicationsRoutes(app, routeContext, ["getNotifications"]);
  registerCommunicationsRoutes(app, routeContext, ["patchNotificationsByNotificationIdRead"]);
  registerAcademicRoutes(app, routeContext, ["postSections"]);
  registerAcademicRoutes(app, routeContext, ["patchSectionsBysectionIdCapacity"]);
  registerSchoolRoutes(app, routeContext, ["putSchool"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissionsDashboard"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissionsPublicLink"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissionsDuplicates"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissions"]);
  registerAdmissionsRoutes(app, routeContext, ["postAdmissions"]);
  registerAdmissionsRoutes(app, routeContext, ["putAdmissionsStudentIdPattern"]);
  registerAdmissionsRoutes(app, routeContext, ["postAdmissionsByadmissionIdInterview"]);
  registerAdmissionsRoutes(app, routeContext, ["patchAdmissionsByadmissionIdStatus"]);
  registerAdmissionsRoutes(app, routeContext, ["postAdmissionsByadmissionIdEnrol"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissionsByadmissionIdDocuments"]);
  registerAdmissionsRoutes(app, routeContext, ["postAdmissionsByadmissionIdDocuments"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissionsByadmissionIdDocumentsBydocumentId"]);
  registerAdmissionsRoutes(app, routeContext, ["getAdmissionsByadmissionIdOfferLetter"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdWithdraw"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdReadmit"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdTransferOut"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdEnrolments"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdSectionTransfer"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdSectionTransfers"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdProgression"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdProgressionEligibility"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdTransferCertificate"]);
  registerFeesRoutes(app, routeContext, ["getFeesItems"]);
  registerFeesRoutes(app, routeContext, ["getFeesShiftsCurrent"]);
  registerFeesRoutes(app, routeContext, ["getFeesShifts"]);
  registerFeesRoutes(app, routeContext, ["postFeesShifts"]);
  registerFeesRoutes(app, routeContext, ["postFeesShiftsByShiftIdClose"]);
  registerFeesRoutes(app, routeContext, ["getFeesExpenses"]);
  registerFeesRoutes(app, routeContext, ["postFeesExpenses"]);
  registerFeesRoutes(app, routeContext, ["getFeesSummary"]);
  registerFeesRoutes(app, routeContext, ["postFeesItems"]);
  registerFeesRoutes(app, routeContext, ["putFeesItemsByItemId"]);
  registerFeesRoutes(app, routeContext, ["getFeesInvoices"]);
  registerFeesRoutes(app, routeContext, ["postFeesInvoices"]);
  registerFeesRoutes(app, routeContext, ["postFeesInvoicesByInvoiceIdVoid"]);
  registerFeesRoutes(app, routeContext, ["postFeesInvoicesByInvoiceIdPayments"]);
  registerFeesRoutes(app, routeContext, ["postFeesPaymentsByPaymentIdReversals"]);
  registerFeesRoutes(app, routeContext, ["getFeesReceiptsByReceiptNumber"]);
  registerFinanceRoutes(app, routeContext, [
    "getFeeStructures", "postFeeStructures", "getFeeStructuresByStructureIdPreview",
    "postFeeStructuresByStructureIdGenerate", "getFeeDiscountTypes", "postFeeDiscountTypes",
    "getFeeDiscountRequests", "postFeeDiscountRequests", "patchFeeDiscountRequestsByRequestId",
    "getFeeRefundRequests", "postFeeRefundRequests", "patchFeeRefundRequestsByRequestId",
    "getFeeAdjustmentRequests", "postFeeAdjustmentRequests", "patchFeeAdjustmentRequestsByRequestId",
    "getFeeArrears", "getFeeArrearsCsv", "postFeeInvoicesByInvoiceIdFollowups",
    "getFeeStudentStatement", "getFeePortalInvoices", "getFeePortalStudentStatement",
    "getFeeReports", "getFeeDashboard", "getCashbookAccounts", "postCashbookAccounts",
    "postCashbookAccountsByAccountIdDeposits", "postCashbookTransfers", "getCashbookEntries",
    "postCashbookAccountsByAccountIdReconciliations", "postCashbookEntriesByEntryIdReversals"
  ]);
  registerStudentsRoutes(app, routeContext, ["getStudents"]);
  registerStudentsRoutes(app, routeContext, ["getAlumni"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsImportPreview"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsImportCommit"]);
  registerAcademicRoutes(app, routeContext, ["getSections"]);
  registerStudentsRoutes(app, routeContext, ["postStudents"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentId"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdSensitiveData"]);
  registerStudentsRoutes(app, routeContext, ["putStudentsByStudentIdSensitiveData"]);
  registerStudentsRoutes(app, routeContext, ["patchStudentsByStudentIdProfile"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdDocuments"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdTransferPackages"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdTransferPackages"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdTransferPackagesByPackageIdApprove"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdDocuments"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdDocumentsByDocumentId"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdEmergencyContacts"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdEmergencyContacts"]);
  registerStudentsRoutes(app, routeContext, ["deleteStudentsByStudentIdEmergencyContactsByContactId"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdGuardians"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdGuardians"]);
  registerStudentsRoutes(app, routeContext, ["patchStudentsByStudentIdGuardiansByGuardianIdAccess"]);
  registerStudentsRoutes(app, routeContext, ["deleteStudentsByStudentIdGuardiansByGuardianId"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdDiscipline"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdDiscipline"]);
  registerStudentsRoutes(app, routeContext, ["getStudentsByStudentIdCommendations"]);
  registerStudentsRoutes(app, routeContext, ["postStudentsByStudentIdCommendations"]);
  registerAttendanceRoutes(app, routeContext, ["getAttendance"]);
  registerAttendanceRoutes(app, routeContext, ["getAttendanceSummary"]);
  registerAttendanceRoutes(app, routeContext, ["postAttendance"]);
  registerAttendanceRoutes(app, routeContext, ["getAttendanceSessionsBySessionId"]);
  registerAttendanceRoutes(app, routeContext, ["patchAttendanceSessionsBySessionIdRecordsByStudentId"]);
  registerAttendanceRoutes(app, routeContext, ["getAttendanceCorrectionRequests"]);
  registerAttendanceRoutes(app, routeContext, ["patchAttendanceCorrectionRequestsByRequestId"]);
  registerAttendanceRoutes(app, routeContext, ["getAttendanceSectionsBySectionIdRoster"]);
  registerAssessmentsRoutes(app, routeContext, ["getMarks"]);
  registerAssessmentsRoutes(app, routeContext, ["getMarksContext"]);
  registerAssessmentsRoutes(app, routeContext, ["getMarksSummary"]);
  registerAssessmentsRoutes(app, routeContext, ["postMarks"]);
  registerAssessmentsRoutes(app, routeContext, ["postMarksByMarkIdSubmit"]);
  registerAssessmentsRoutes(app, routeContext, ["postMarksByMarkIdApprove"]);
  registerAssessmentsRoutes(app, routeContext, ["postMarksByMarkIdPublish"]);
  registerAssessmentsRoutes(app, routeContext, ["postMarksByMarkIdAmend"]);
  registerAssessmentsRoutes(app, routeContext, ["getMarksStudentsByStudentId"]);
  registerAssessmentsRoutes(app, routeContext, ["getGradingBands"]);
  registerAssessmentsRoutes(app, routeContext, ["putGradingBands"]);
  registerAssessmentsRoutes(app, routeContext, ["getGradingPolicy"]);
  registerAssessmentsRoutes(app, routeContext, ["putGradingPolicy"]);
  registerAssessmentsRoutes(app, routeContext, ["getReportCardsStudentsByStudentId"]);
  registerAssessmentsRoutes(app, routeContext, ["postReportCardsStudentsByStudentIdDrafts"]);
  registerAssessmentsRoutes(app, routeContext, ["postReportCardsByReportIdSubmit"]);
  registerAssessmentsRoutes(app, routeContext, ["postReportCardsByReportIdApprove"]);
  registerAssessmentsRoutes(app, routeContext, ["postReportCardsByReportIdPublish"]);
  registerExamsRoutes(app, routeContext, ["getExamTypes"]);
  registerExamsRoutes(app, routeContext, ["postExamTypes"]);
  registerExamsRoutes(app, routeContext, ["patchExamTypesByExamTypeId"]);
  registerExamsRoutes(app, routeContext, ["getExams"]);
  registerExamsRoutes(app, routeContext, ["getExamsMonitoring"]);
  registerExamsRoutes(app, routeContext, ["postExams"]);
  registerExamsRoutes(app, routeContext, ["patchExamsByExamId"]);
  registerExamsRoutes(app, routeContext, ["postExamsByExamIdSchedule"]);
  registerExamsRoutes(app, routeContext, ["putExamsByExamIdScheduleEntry"]);
  registerExamsRoutes(app, routeContext, ["postExamsByExamIdSchedulePublish"]);
  registerExamsRoutes(app, routeContext, ["postExamsByExamIdMarksOpen"]);

  registerAssignmentsRoutes(app, routeContext, [
    "listAssignments", "getAssignmentSubmissions", "postAssignment", "patchAssignment",
    "transitionAssignment", "uploadAssignmentAttachment", "portalAssignments",
    "submitAssignment", "uploadSubmissionAttachment", "gradeSubmission",
    "downloadAssignmentAttachment", "downloadPortalAssignmentAttachment"
  ]);
}
