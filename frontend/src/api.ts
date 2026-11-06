import { openDB } from 'idb';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
let accessToken: string | null = null;
let accessTokenVersion = 0;
let refreshPromise: Promise<string> | null = null;
let currentUserPromise: Promise<User> | null = null;

export type Student = {
  id: string; campusId: string; studentNo: string; givenNameAm: string;
  fatherNameAm: string; grandfatherNameAm: string; givenNameEn: string;
  fatherNameEn: string; grandfatherNameEn: string; gender: 'female' | 'male' | 'other';
  sectionName: string; sectionId?: string | null; gradeLevelId?: string | null;
  stream?: 'natural_science' | 'social_science' | null; status: string;
  dateOfBirth?: string | null; guardianPhone?: string | null;
  previousSchool?: string | null; hasPortalAccount?: boolean;
};
export type StudentCredentials = { studentName: string; username: string; temporaryPassword: string };
export type StudentSensitiveData = {
  idNumber: string | null; healthNotes: string | null; specialNeeds: string | null;
  allergies: string | null
};
export type StudentDocument = {
  id: string; studentId: string; documentType: 'photo' | 'birth_certificate' |
    'previous_school_record' | 'transfer_consent' | 'other'; originalName: string; mimeType: string;
  sizeBytes: number; sha256: string; createdAt: string
};
export type StudentTransferPackage = {
  id: string; studentId: string; recipientSchool: string; guardianName: string;
  guardianRelationship: string; consentRecordedOn: string;
  status: 'pending' | 'approved' | 'rejected'; expiresAt: string | null; createdAt: string | null
};
export type StudentTransferPacket = {
  recipientSchool: string; sourceSchool: string;
  student: Pick<Student, 'studentNo' | 'givenNameAm' | 'fatherNameAm' | 'grandfatherNameAm' |
    'givenNameEn' | 'fatherNameEn' | 'grandfatherNameEn' | 'gender' | 'dateOfBirth' | 'previousSchool'>;
  guardianConsent: { guardianName: string; relationship: string; recordedOn: string };
  academicHistory: { academicYear: string; grade: string; section: string; status: string; outcome: string | null }[]
};
export type StudentDisciplineRecord = {
  id: string; studentId: string; recordedOn: string; category: string;
  details: string | null; actionTaken: string | null; createdAt: string
};
export type PublicAdmissionInfo = {
  schoolName: string; campusName: string; address: string; phone: string;
  grades: Pick<GradeLevel, 'id' | 'nameEn' | 'nameAm'>[]
};
export type StudentEmergencyContact = {
  id: string; studentId: string; name: string; phone: string;
  relationship: string; priority: number; createdAt: string
};
export type StudentCreationResult = { student: Student; credentials: StudentCredentials };
export type StudentEnrollment = {
  id: string; academicYearId: string; academicYear: string; gradeLevelId: string | null;
  gradeNameEn: string | null; gradeNameAm: string | null; sectionId: string;
  sectionName: string; status: 'active' | 'completed' | 'withdrawn';
  enrolledOn: string; leftOn: string | null; outcome: string | null
};
export type StudentImportRowReport = {
  rowNumber: number; eligible: boolean;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[]
};
export type StudentImportPreview = {
  totalRows: number; eligibleCount: number; invalidCount: number;
  warningCount: number; rows: StudentImportRowReport[]
};
export type StudentImportResult = {
  totalRows: number; createdCount: number; skippedCount: number;
  rows: StudentImportRowReport[];
  credentials: (StudentCredentials & { rowNumber: number; studentNo: string })[]
};
export type StudentProfileUpdate = Partial<Pick<Student,
  'givenNameAm' | 'fatherNameAm' | 'grandfatherNameAm' | 'givenNameEn' | 'fatherNameEn' |
  'grandfatherNameEn' | 'gender' | 'dateOfBirth' | 'guardianPhone' | 'previousSchool'>>;
export type StudentGuardian = {
  id: string; givenNameAm: string; fatherNameAm: string; grandfatherNameAm: string;
  givenNameEn: string; fatherNameEn: string; grandfatherNameEn: string; phone: string;
  email: string | null; relationship: string; isPrimary: boolean; isVerified: boolean;
  canViewResults: boolean; canViewFees: boolean; hasPortalAccount: boolean;
};
export type StudentCommendation = {
  id: string; campusId: string; studentId: string; recordedOn: string;
  titleEn: string; titleAm: string; descriptionEn: string; descriptionAm: string;
  createdBy: string; createdAt: string
};
export type User = {
  id: string; name: string; email?: string; role: string; campusIds: string[];
  activeCampusId: string; sessionId?: string; mustChangePassword?: boolean;
  permissions?: string[]
};
export type SchoolAccount = {
  id: string; name: string; email: string | null; role: string;
  isActive: boolean; campusIds: string[]
};
export type ManagedRole = {
  id: string; organizationId: string | null; key: string; name: string;
  isSystem: boolean; permissions: string[]
};
export type PermissionDefinition = { key: string; description: string };
export type RoleCatalog = { roles: ManagedRole[]; permissions: PermissionDefinition[] };
export type EffectivePermissions = { userId: string; role: string; permissions: string[] };
export type PlatformUser = SchoolAccount;
export type SubscriptionPlan = {
  id: string; code: string; name: string; description: string; monthlyPrice: number;
  currencyCode: string; trialDays: number; studentLimit: number | null;
  staffLimit: number | null; siteLimit: number | null; billingCycle: 'monthly' | 'termly' | 'yearly';
  maxUsers: number | null; storageLimitBytes: number | null;
  modules: string[]; isActive: boolean
};
export type SchoolSubscription = {
  id: string; status: string; trialStartedAt: string | null; trialEndsAt: string | null;
  periodStartedAt: string | null; periodEndsAt: string | null; expiryWarning?: string | null;
  plan: SubscriptionPlan;
  invoices: { id: string; invoiceNumber: string; amount: number; currencyCode: string;
    status: string; dueOn: string | null; issuedAt: string | null; paidAt: string | null;
    payments?: { id: string; amount: number; reference: string | null; receivedOn: string;
      refundedAmount: number; refunds?: { id: string; amount: number; reason: string }[] }[] }[]
};
export type OrganizationSettings = {
  id: string; name: string; status: string; preferredLocale: 'en' | 'am';
  schoolCode: string; academicConfiguration?: {
    calendarType: 'ethiopian' | 'gregorian';
    dateFormat: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'; defaultLocale: 'en' | 'am'
  };
  currencyCode: string; branding: { logoUrl: string; primaryColor: string }
};
export type OrganizationBranch = {
  id: string; organizationId: string; name: string; address: string;
  phone: string; timezone: string; isActive: boolean
};
export type PlatformSchool = OrganizationSettings & {
  owner: { name: string; email: string } | null;
  adminInvitationAvailable?: boolean;
  campuses: { id: string; name: string }[]; studentCount: number; userCount: number;
  subscription: { status: string; trialEndsAt: string | null; periodEndsAt: string | null;
    planCode: string; planName: string; expiryWarning?: string | null } | null
};
export type PlatformSchoolProvisioning = {
  organizationId: string; status: string; trialEndsAt: string;
  invitation: Omit<AccountInvitation, 'invitationUrl'>; invitationUrl: string
};
export type PlatformSchoolDraft = {
  schoolName: string; ownerName: string; ownerEmail: string; schoolPhone: string;
  address: string; locale: 'en' | 'am'; currencyCode: 'ETB' | 'USD'; timezone: string;
  academicConfiguration: {
    calendarType: 'ethiopian' | 'gregorian';
    dateFormat: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd'; defaultLocale: 'en' | 'am'
  }
};
export type PlatformSettings = {
  defaultLocale: 'en' | 'am'; currencyCode: string;
  dateFormat: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd';
  calendarType: 'ethiopian' | 'gregorian'; smtpHost: string; smtpPort: number;
  smtpSecure: boolean; smtpUser: string; smtpFrom: string;
  smtpPasswordConfigured: boolean; smtpConfigured: boolean
};
export type SupportTicket = {
  id: string; organizationId: string; campusId: string | null;
  ticketType: 'platform' | 'internal'; subject: string; category: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'in_progress' | 'waiting_on_school' | 'resolved' | 'closed';
  createdBy: string; assignedTo: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string;
  comments?: { id: string; authorId: string; body: string; isInternal: boolean; createdAt: string }[];
  attachments?: { id: string; originalName: string; mimeType: string; sizeBytes: number }[]
};
export type SupportAssignee = { id: string; name: string };
export type PlatformMonitoring = {
  api: string; database: { reachable: boolean; mode: string; errorCode?: string };
  storageBySchool: { id: string; name: string; usedBytes: number }[];
  runtime: {
    processStartedAt: string; uptimeSeconds: number; requestCount: number;
    serverErrorCount: number; lastServerErrorAt: string | null;
    backgroundJobs: { name: string; status: string; lastStartedAt: string | null;
      lastSucceededAt: string | null; lastFailedAt: string | null; lastErrorCode: string | null }[]
  };
  backupLatest: { id: string; kind: string; startedAt: string; completedAt: string | null;
    status: string; sizeBytes: number | null; errorCode: string | null } | null
};
export type BackupRun = {
  id: string; kind: string; startedAt: string; completedAt: string | null; status: string;
  sizeBytes: number | null; errorCode: string | null
};
export type PlatformDashboard = {
  organizationId: string; generatedAt: string;
  database: { reachable: boolean; checkedAt: string };
  totals: {
    schools: number; pending: number; active: number; suspended: number; students: number;
    staff: number; activeSubscriptions: number; expiredSubscriptions: number;
    trialingSubscriptions: number;
    expiringSubscriptions: number; revenueCollected: number; currentMonthRevenue: number;
    outstanding: number; refunds: number; netRevenue: number; storageUsedBytes: number
  };
  storageBySchool: { organizationId: string; usedBytes: number; limitBytes: number | null }[];
  schools: PlatformSchool[]; plans: SubscriptionPlan[]
};
export type PlatformOutstandingReport = {
  from: string | null; to: string | null;
  totals: { currencyCode: string; invoiceCount: number; outstandingAmount: number }[];
  items: {
    organizationId: string; schoolName: string; invoiceNumber: string;
    currencyCode: string; issuedOn: string; dueOn: string | null;
    invoiceAmount: number; paidAmount: number; outstandingAmount: number
  }[]
};
export type OrganizationClosure = {
  id: string; organizationId: string; schoolName: string; status: string;
  reason: string; requesterName: string; requestedAt: string; exportedAt: string | null;
  retentionUntil: string | null; financialRetentionUntil: string | null; completedAt?: string | null
};
export type AuditEvent = {
  id: string; organizationId: string | null; organizationName: string;
  campusId: string | null; campusName: string; actorId: string | null;
  actorName: string; actorEmail: string; actorRole: string; action: string;
  entityType: string; entityId: string | null; before: unknown; after: unknown;
  ipAddress: string; userAgent: string; createdAt: string
};
export type AuditFilters = {
  from?: string; to?: string; userId?: string; action?: string;
  entityType?: string; entityId?: string; search?: string;
  page: number; pageSize: number
};
export type AuditPage = {
  events: AuditEvent[]; total: number; page: number; pageSize: number
};
export type ActiveSession = {
  sessionId: string; userId: string; name: string; email: string; role: string;
  campusName: string; ipAddress: string; userAgent: string;
  createdAt: string; lastSeenAt: string; expiresAt: string
};
export type AccountInvitation = {
  id: string; email: string; role: string; name: string; expiresAt: string; invitationUrl: string
};
export type StaffInvitationRole =
  | 'principal' | 'registrar' | 'system_admin' | 'academic_head' | 'homeroom_teacher'
  | 'subject_teacher' | 'hr_admin' | 'accountant_cashier' | 'counsellor';
export type InvitationDetails = { email: string; role: string; name: string; expiresAt: string };
export type PortalReportSnapshot = {
  termId: string; termName: string;
  subjects: {
    subjectId: string; subjectNameEn: string; subjectNameAm: string;
    value: number; maxValue: number; percent: number;
    band: Pick<GradingBand, 'code' | 'nameEn' | 'nameAm'> | null
  }[];
  totalValue: number; totalMaxValue: number; overallPercent: number;
  overallBand: Pick<GradingBand, 'code' | 'nameEn' | 'nameAm'> | null
};
export type PortalHome = {
  role: 'student' | 'parent_guardian';
  students: { student: {
    id: string; campusId: string; studentNo: string; name: string; nameAm: string;
    sectionName: string; status: string
  }; canViewResults: boolean; canViewFees: boolean;
  results: { assessmentName: string; value: number; maxValue: number }[];
  reports: {
    revision: number; publishedAt: string;
    snapshot: PortalReportSnapshot
  }[];
  attendance: { date: string; status: string }[];
  fees: { invoiceNumber: string; totalAmount: number; dueDate: string | null; status: string; currencyCode: string }[]
  }[]
};
export type Dashboard = {
  studentCount: number; attendanceSessions: number; marksRecorded: number; attendanceToday: number;
  recentStudents: Student[]; sectionDistribution: { sectionName: string; count: number }[];
  genderTotals: { female: number; male: number; other: number }; mode: string
};
export type HrDashboard = {
  totalStaff: number; activeStaff: number; pendingLeaveRequests: number;
  contractsExpiringWithin30Days: number
};
export type PayrollRule = {
  id: string; code: string; name: string; kind: 'tax' | 'pension'; status: string;
  configuration: { type: 'flat_rate'; rateBps: number } |
    { type: 'brackets'; brackets: { upToMinor: number | null; rateBps: number }[] }
};
export type PayrollSalaryStructure = {
  id: string; staffId: string; currencyCode: string; basicSalaryMinor: number;
  allowances: { code: string; name: string; amountMinor: number }[];
  deductions: { code: string; name: string; amountMinor: number }[];
  taxRuleId: string | null; pensionRuleId: string | null;
  overtimeRateMinorPerHour: number; effectiveFrom: string; effectiveTo: string | null;
  status: string
};
export type PayrollPeriod = {
  id: string; code: string; currencyCode: string; startsOn: string; endsOn: string;
  status: string; run?: PayrollRun | null
};
export type PayrollInput = {
  id: string; periodId: string; staffId: string; attendanceDays: number;
  overtimeMinutes: number; bonusMinor: number; adjustmentMinor: number;
  adjustmentReason: string; sourceAttendanceDays: number;
  sourceUnpaidLeaveHalfDays: number; loadedFromHr: boolean
};
export type PayrollLine = {
  id: string; staffId: string; staffName: string; departmentId: string | null;
  currencyCode: string; baseSalaryMinor: number; proratedBaseMinor: number;
  allowancesMinor: number; overtimeMinor: number; bonusMinor: number;
  adjustmentMinor: number; unpaidLeaveDeductionMinor: number; taxMinor: number;
  pensionMinor: number; otherDeductionsMinor: number; grossMinor: number;
  netMinor: number; paidMinor: number; payments: PayrollPayment[]
};
export type PayrollPayment = {
  id: string; lineId: string; idempotencyKey: string; reference: string;
  amountMinor: number; currencyCode: string; paymentDate: string; paidAt: string
};
export type PayrollRun = {
  id: string; periodId: string; status: string; preparedBy: string;
  reviewedBy: string | null; period?: PayrollPeriod;
  lines?: PayrollLine[]; summary?: {
    staffCount: number; grossMinor: number; netMinor: number; currencyCode: string
  }
};
export type PayrollPayslip = {
  id: string; runId: string; periodId: string; lineId: string; staffId: string;
  snapshot: PayrollLine & { period: PayrollPeriod }; generatedAt: string
};
export type PayrollDashboard = {
  currentPeriods: number; periods: PayrollPeriod[];
  currencies: { currencyCode: string; grossMinor: number; netMinor: number;
    pendingApprovals: number; pendingPayments: number }[]
};
export type LibraryCategory = { id: string; name: string; status: string };
export type LibraryBook = {
  id: string; categoryId: string | null; title: string; author: string;
  isbn: string | null; publisher: string; description: string; status: string;
  copies?: LibraryCopy[]
};
export type LibraryCopy = {
  id: string; bookId: string; copyNumber: string; barcode: string;
  condition: string; shelfLocation: string; status: string; book?: LibraryBook
};
export type LibraryMember = {
  id: string; memberType: 'student' | 'staff'; studentId: string | null;
  staffId: string | null; status: string; name: string; studentNo: string | null
};
export type LibraryLoan = {
  id: string; bookId: string; copyId: string; memberId: string; issuedOn: string;
  dueOn: string; returnedOn: string | null; status: string; renewalCount: number;
  book?: LibraryBook; copy?: LibraryCopy; member?: LibraryMember; fine?: LibraryFine | null
};
export type LibraryReservation = {
  id: string; bookId: string; memberId: string; queuePosition: number; status: string;
  readyCopyId: string | null; readyUntil: string | null; book?: LibraryBook
};
export type LibraryFine = {
  id: string; loanId: string; memberId: string; amountMinor: number; currencyCode: string;
  overdueDays: number; status: string; reason: string; paidOn: string | null;
  member?: LibraryMember
};
export type LibrarySettings = {
  loanPeriodDays: number; maxActiveLoans: number; maxRenewals: number;
  fineMinorPerDay: number; currencyCode: string
};
export type PortalLibrary = {
  loans: LibraryLoan[]; reservations: LibraryReservation[]; fines: LibraryFine[]
};
export type InventoryCategory = { id: string; name: string; status: string };
export type InventorySupplier = {
  id: string; name: string; contactName: string; email: string; phone: string;
  address: string; status: string
};
export type InventoryItem = {
  id: string; categoryId: string; sku: string; name: string; unit: string;
  reorderLevel: number; currentQuantity: number; averageUnitCostMinor: number;
  currencyCode: string; status: string; lowStock?: boolean
};
export type InventoryPurchaseLine = {
  id: string; lineNumber: number; itemId: string; quantity: number; receivedQuantity: number;
  unitCostMinor: number; item?: Pick<InventoryItem, 'id' | 'name' | 'sku'>
};
export type InventoryPurchase = {
  id: string; purchaseNumber: string; supplierId: string; purchasedOn: string;
  expectedOn: string | null; currencyCode: string; status: string; notes?: string;
  lines: InventoryPurchaseLine[]; supplier?: { id: string; name: string }
};
export type InventoryMovement = {
  id: string; itemId: string; movementType: 'in' | 'out' | 'adjustment';
  quantityDelta: number; quantityAfter: number; unitCostMinor: number;
  totalCostMinor: number; currencyCode: string; movedOn: string; reason: string;
  item?: Pick<InventoryItem, 'id' | 'name' | 'sku'>
};
export type FixedAsset = {
  id: string; assetTag: string; category: string; name: string; purchasedOn: string;
  purchaseCostMinor: number; currencyCode: string; condition: string; location: string;
  status: string; notes: string;
  allocation?: AssetAllocation | null
};
export type AssetAllocation = {
  id: string; assetId: string; staffId: string | null; roomId: string | null;
  allocatedOn: string; returnedOn: string | null; status: string; notes: string;
  asset?: FixedAsset
};
export type InventoryDashboard = {
  itemCount: number; lowStockCount: number;
  stockValueByCurrency: { currencyCode: string; amountMinor: number }[];
  assetsAvailable: number; assetsAllocated: number; lowStockItems: InventoryItem[]
};
export type FrontDeskVisitor = {
  id: string; visitorName: string; purpose: string; hostStaffId: string | null;
  status: string; checkedInAt: string; checkedOutAt: string | null
};
export type FrontDeskAppointment = {
  id: string; parentName: string; studentId: string | null; staffId: string;
  appointmentAt: string; purpose: string; status: string
};
export type FrontDeskMessage = {
  id: string; senderName: string; recipientStaffId: string; subject: string;
  message: string; status: string; createdAt: string
};
export type FrontDeskAuthorization = {
  id: string; studentId: string; guardianName: string; relationship: string; phone: string;
  authorizationType: 'regular' | 'temporary'; oneTime: boolean; expiresAt: string | null;
  usedAt: string | null; status: string
};
export type FrontDeskPickupEvent = {
  id: string; studentId: string; eventType: string; pickedUpBy: string | null;
  authorizationId: string | null; releasedBy: string; releasedAt: string;
  note: string; correctionReason: string | null
};
export type FrontDeskPickupAttempt = {
  id: string; studentId: string; personName: string; reason: string;
  verificationNote: string; attemptedAt: string
};
export type FrontDeskDelivery = {
  id: string; recipientName: string; description: string; status: string;
  receivedAt: string; collectedAt: string | null
};
export type FrontDeskLostFound = {
  id: string; description: string; locationFound: string; foundAt: string;
  status: string; claimedBy: string | null; claimedAt: string | null
};
export type FrontDeskDashboard = {
  visitorsToday: number; appointmentsToday: number; pendingMessages: number
};
export type FrontDeskSettings = {
  blockAbsentPickup: boolean; blockReleasedToday: boolean; securityRoleKey: string | null
};
export type HrContract = {
  id: string; staffId: string; contractType: string; startsOn: string;
  endsOn: string | null; renewalDueOn: string | null; status: string; notes: string;
  createdAt?: string; archivedAt?: string | null
};
export type HrLeaveType = {
  id: string; name: string; kind: 'annual' | 'sick' | 'unpaid';
  annualEntitlementHalfDays: number; carryOverLimitHalfDays: number; isActive: boolean
};
export type HrLeaveBalance = {
  id: string; staffId: string; leaveTypeId: string; year: number;
  entitledHalfDays: number; carryOverHalfDays: number; usedHalfDays: number;
  remainingHalfDays: number; leaveType?: string
};
export type HrVacancy = {
  id: string; departmentId: string | null; title: string; description: string;
  status: string; createdAt?: string
};
export type HrApplicant = {
  id: string; vacancyId: string; givenName: string; fatherName: string;
  grandfatherName: string; email: string; phone: string; status: string; staffId: string | null
};
export type HrInterview = {
  id: string; applicantId: string; scheduledAt: string; notes: string; status: string
};
export type HrPerformanceCycle = {
  id: string; name: string; startsOn: string; endsOn: string; status: string
};
export type HrPerformanceGoal = {
  id: string; staffId: string; cycleId: string; title: string; details: string; status: string
};
export type HrPerformanceEvaluation = {
  id: string; staffId: string; cycleId: string; rating: number; feedback: string
};
export type HrTrainingCourse = {
  id: string; title: string; description: string; startsOn: string; endsOn: string; status: string
};
export type HrTrainingEnrollment = {
  id: string; courseId: string; staffId: string; status: string; certificateName?: string | null
};
export type HrDocument = {
  id: string; category: string; originalName: string; mimeType: string; sizeBytes: number
};
export type ReportDefinition = {
  id: string; category: string; permission: string; roleScope: string[];
  columns: string[]; filters: string[]; csvExport: boolean; printView: boolean;
  pageSize: number; maxPageSize: number
};
export type ReportFilterOptions = {
  years: { id: string; label: string }[];
  terms: { id: string; yearId: string; label: string }[];
  grades: { id: string; label: string }[];
  sections: { id: string; yearId: string; gradeId: string; label: string }[]
};
export type ReportQuery = {
  year?: string; term?: string; grade?: string; section?: string;
  from?: string; to?: string; workloadLimit?: number; page?: number; pageSize?: number
};
export type ReportResult = {
  report: string; columns: string[];
  rows: Record<string, string | number | null>[];
  summary: Record<string, unknown>;
  page: number; pageSize: number; total: number; hasMore: boolean
};
export type Mark = {
  id: string; examId?: string; studentId: string; assessmentName: string; maxValue: number;
  value: number; state: 'draft' | 'submitted' | 'approved' | 'locked';
  termId?: string | null; subjectId?: string | null; enteredBy?: string;
  approvedBy?: string | null; publishedBy?: string | null
};
export type ExamType = {
  id: string; organizationId: string; code: string; name: string;
  weightBasisPoints: number; weightPercent: number; isActive: boolean
};
export type ExamScheduleEntry = {
  id: string; examId: string; examTitle: string; status: string;
  sectionId: string; sectionName: string; examDate: string; startsAt: string; endsAt: string;
  roomId: string | null; roomName: string | null;
  invigilatorIds?: string[]; invigilators?: string[]
};
export type ExamRecord = {
  id: string; organizationId: string; campusId: string; academicYearId: string | null;
  termId: string | null; gradeLevelId: string | null; subjectId: string | null;
  examTypeId: string; title: string; weightBasisPoints: number; maxValue: number;
  status: 'draft' | 'scheduled' | 'schedule_published' | 'marks_open' |
    'submitted' | 'reviewed' | 'approved' | 'published';
  isLegacy: boolean; schedulePublishedAt: string | null; marksOpenedAt: string | null;
  examType?: string; scheduleEntries: ExamScheduleEntry[]
};
export type ExamMonitorRow = {
  id: string; title: string; status: ExamRecord['status'];
  expectedMarks: number; recordedMarks: number; missingMarks: number
};
export type AssignmentAttachment = {
  id: string; assignmentId: string; submissionId: string | null;
  type: 'assignment' | 'submission'; originalName: string; mimeType: string;
  sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string
};
export type AssignmentSubmission = {
  id: string; assignmentId: string; studentId: string; studentName: string;
  text: string | null; submittedAt: string; isLate: boolean;
  grade: number | null; feedback: string | null; gradedBy: string | null;
  gradedAt: string | null; status: 'submitted' | 'graded'; attachments: AssignmentAttachment[]
};
export type AssignmentRecord = {
  id: string; organizationId: string; campusId: string; academicYearId: string;
  termId: string; gradeLevelId: string; sectionId: string; sectionName: string;
  subjectId: string; subjectName: string; title: string; instructions: string;
  dueAt: string; status: 'draft' | 'published' | 'closed' | 'archived';
  createdBy: string; publishedAt: string | null; createdAt: string; updatedAt: string;
  attachments: AssignmentAttachment[]; studentId?: string; studentName?: string;
  submission?: AssignmentSubmission | null
};
export type TermMarksSummary = {
  termId: string; termName: string; status: 'provisional';
  totals: {
    assessmentCount: number; students: number; earnedPoints: number;
    possiblePoints: number; percent: number | null
  };
  bySubject: {
    subjectId: string; subjectNameEn: string; subjectNameAm: string;
    assessmentCount: number; students: number; earnedPoints: number;
    possiblePoints: number; percent: number | null
  }[]
};
export type GradingBand = {
  id: string; campusId: string; code: string; nameEn: string; nameAm: string; minPercent: number
};
export type GradingPolicy = {
  campusId: string; scoringMethod: 'points_weighted' | 'equal_subject_weighted';
  confirmedBy: string | null; confirmedAt: string | null
};
export type ReportCardSnapshot = {
  studentId: string; termId: string; termName: string;
  subjects: {
    subjectId: string; subjectNameEn: string; subjectNameAm: string;
    assessmentCount: number; value: number; maxValue: number; percent: number;
    band: Pick<GradingBand, 'code' | 'nameEn' | 'nameAm'> | null;
    calculationBasis?: {
      examId: string; weightBasisPoints: number;
      scoreBasisPoints: number | null; weightedBasisPoints: number
    }[]
  }[];
  totalValue: number; totalMaxValue: number; overallPercent: number;
  overallBand: Pick<GradingBand, 'code' | 'nameEn' | 'nameAm'> | null;
  status: 'provisional'; scoringMethod: GradingPolicy['scoringMethod'];
  gradingPolicyConfirmed: boolean; gradingPolicyConfirmedAt: string | null;
  sourceMarkFingerprint: string; missingExamCount: number;
  calculationBasis: {
    method: string; rounding: string;
    subjects: { subjectId: string; exams: {
      examId: string; weightBasisPoints: number;
      scoreBasisPoints: number | null; weightedBasisPoints: number
    }[] }[]
  }
};
export type TermReportWorkflow = {
  id: string; campusId: string; studentId: string; termId: string; revision: number;
  status: 'draft' | 'submitted' | 'approved' | 'published';
  amendmentReason: string | null;
  createdBy: string; submittedBy: string | null; approvedBy: string | null; publishedBy: string | null;
  createdAt: string; submittedAt: string | null; approvedAt: string | null; publishedAt: string | null;
  gradingPolicyConfirmedAt: string | null; snapshot: ReportCardSnapshot
};
export type ReportCard = ReportCardSnapshot & { workflow: TermReportWorkflow | null };
export type FeeItem = {
  id: string; campusId: string; code: string; nameEn: string; nameAm: string;
  amount: number; currencyCode: string; isActive: boolean
};
export type FeePayment = {
  id: string; campusId: string; invoiceId: string; receiptNumber: string | null;
  entryType: 'payment' | 'reversal'; reversesPaymentId: string | null;
  amount: number; method: 'cash' | 'bank_transfer' | 'mobile_money' | 'other';
  reference: string | null; reason: string | null; recordedBy: string;
  recordedAt: string; currencyCode?: string; duplicate?: boolean
};
export type FeeInvoice = {
  id: string; campusId: string; studentId: string; studentNo?: string; studentName?: string;
  invoiceNumber: string; currencyCode: string; totalAmount: number; dueDate: string | null;
  status: 'issued' | 'partially_paid' | 'paid' | 'void'; issuedBy: string; createdAt: string;
  paidAmount: number; balanceDue: number;
  lines: {
    id: string; feeItemId: string | null; descriptionEn: string; descriptionAm: string;
    unitAmount: number; quantity: number; lineTotal: number
  }[];
  payments: FeePayment[]
};
export type FeeReceipt = FeePayment & {
  invoiceNumber: string; invoiceTotal: number; studentId: string;
  studentNo: string; studentName: string
};
export type CashierShift = {
  id: string; campusId: string; openedBy: string; closedBy: string | null;
  currencyCode: string; openingFloat: number; closingCash: number | null;
  expectedCash: number | null; variance: number | null; status: 'open' | 'closed';
  recordedOn: string; openedAt: string; closedAt: string | null
};
export type FeeExpense = {
  id: string; campusId: string; cashierShiftId: string; category: string;
  description: string; amount: number; currencyCode: string;
  method: FeePayment['method']; reference: string | null;
  recordedBy: string; recordedOn: string; recordedAt: string
};
export type FeeSummary = {
  from: string; to: string;
  totals: {
    currencyCode: string; payments: number; reversals: number;
    income: number; expenses: number; net: number
  }[]
};
export type FeeStructureInstallment = {
  id: string; installmentNumber: number; dueDate: string; amountMinor: number
};
export type FeeStructure = {
  id: string; academicYearId: string; gradeLevelId: string; name: string;
  currencyCode: string; status: string; installments: FeeStructureInstallment[]
};
export type FeeDiscountRequest = {
  id: string; studentId: string; discountTypeId: string; periodKey: string;
  reason: string; status: string; requestedBy: string
};
export type FeeDiscountType = {
  id: string; code: string; name: string; category: 'sibling' | 'staff_child' | 'scholarship' | 'other';
  discountKind: 'percentage' | 'fixed'; isActive: boolean
};
export type FeeRefundRequest = {
  id: string; paymentId: string; amountMinor: number; reason: string;
  status: string; requestedBy: string
};
export type FeeAdjustmentRequest = {
  id: string; invoiceId: string; adjustmentType: 'credit' | 'debit';
  amountMinor: number; reason: string; status: string; requestedBy: string
};
export type FinanceDashboard = {
  date: string; collections: { currencyCode: string; amount: number }[];
  overdueInvoices: number; outstandingByCurrency: { currencyCode: string; amount: number }[]
};
export type FinanceReportRow = {
  date?: string; invoiceNumber?: string; studentId?: string; studentName?: string;
  className?: string; feeTypes?: string; category?: string; description?: string;
  amount: number; currencyCode: string; entryType?: string; method?: string
};
export type FinanceReport = {
  type: string; from: string; to: string; rows: FinanceReportRow[];
  totalsByCurrency: { currencyCode: string; amount: number }[]
};
export type FeeArrearsRow = {
  invoiceId: string; invoiceNumber: string; studentId: string; studentNo: string;
  studentName: string; sectionName: string; dueDate: string; daysOverdue: number;
  bucket: string; balanceDue: number; currencyCode: string;
  followups?: { id: string; note: string; nextContactOn: string | null; createdAt: string }[]
};
export type CashbookAccount = {
  id: string; name: string; accountType: 'cash' | 'bank'; currencyCode: string;
  openingBalanceMinor: number; balanceMinor: number; isActive: boolean
};
export type CashbookEntry = {
  id: string; accountId: string; entryType: string; direction: 'credit' | 'debit';
  amountMinor: number; currencyCode: string; description: string; recordedOn: string
};
export type CampusAnnouncement = {
  id: string; campusId: string; titleEn: string; titleAm: string;
  bodyEn: string; bodyAm: string; createdBy: string; publishedAt: string;
  audience?: 'school' | 'class'; sectionId?: string | null
};
export type CampusEvent = {
  id: string; campusId: string; titleEn: string; titleAm: string;
  descriptionEn: string; descriptionAm: string; startsOn: string; endsOn: string;
  startsAt: string | null; endsAt: string | null; location: string; createdBy: string;
  type?: 'school' | 'meeting' | 'holiday' | 'activity'; status?: string;
  audience?: 'school' | 'class'; sectionId?: string | null; createdAt?: string | null
};
export type PortalCalendar = {
  students: { id: string; name: string; sectionId: string | null; sectionName: string }[];
  announcements: CampusAnnouncement[];
  events: (CampusEvent & { type: string })[];
  timetable: {
    id: string; sectionId: string; sectionName?: string; subjectId: string;
    subjectName: string; teacherName: string; teacherUserId?: string;
    dayOfWeek: number | null; periodNumber: number | null; roomId: string | null
  }[]
};
export type PortalRequest = {
  id: string; organizationId: string; campusId: string; requesterId: string; studentId: string;
  type: string; category?: string; subject: string; details: string; status: string;
  handledBy: string | null; response: string | null; createdAt: string; statusChangedAt: string | null
};
export type PortalMessage = {
  id: string; threadId: string; senderId: string; body: string;
  status: string; sentAt: string
};
export type PortalMessageThread = {
  id: string; studentId: string; status: string; createdAt: string;
  participants: { userId: string; role: string; name: string }[];
  unreadCount: number; messages: PortalMessage[]
};
export type UserNotification = {
  id: string; campusId: string; sourceType: string; sourceId: string;
  titleEn: string; titleAm: string; bodyEn: string; bodyAm: string;
  readAt: string | null; createdAt: string
};
export type NotificationInbox = { items: UserNotification[]; unreadCount: number };
export type AttendanceRecord = { studentId: string; studentName: string; status: string; reason: string };
export type AttendanceSession = {
  id: string; date: string; sectionId: string; records?: AttendanceRecord[]; clientUuid?: string
};
export type AttendanceCorrectionRequest = {
  id: string; campusId: string; sessionId: string; studentId: string;
  attendanceDate?: string; originalStatus: string; requestedStatus: string;
  reason: string; requestedBy: string; status: 'pending' | 'approved' | 'rejected';
  requestedAt: string | null; reviewedBy?: string | null; reviewNote?: string | null;
  reviewedAt?: string | null; studentName?: string
};
export type AttendanceCorrectionResult = AttendanceSession | {
  approvalRequired: true; request: AttendanceCorrectionRequest
};
export type AttendanceSummaryTotals = {
  sessions: number; records: number; present: number; absent: number; late: number; excused: number;
  attendanceRate: number | null
};
export type AttendanceSummary = {
  from: string; to: string; totals: AttendanceSummaryTotals;
  bySection: (AttendanceSummaryTotals & { sectionId: string; sectionName: string })[];
  byDate: (AttendanceSummaryTotals & { date: string })[]
};
export type SchoolProfile = { id: string; name: string; address: string; phone: string; timezone: string };
export type Section = {
  id: string; campusId: string; name: string; gradeName?: string; gradeLevelId?: string;
  capacity?: number | null; shift?: 'morning' | 'afternoon' | 'evening';
  stream?: 'natural_science' | 'social_science' | null
};
export type AcademicYear = { id: string; campusId: string; labelEc: string; startDate: string; endDate: string; status: string } | null;
export type AcademicYearRecord = NonNullable<AcademicYear>;
export type GradeLevel = { id: string; campusId: string; code: string; nameEn: string; nameAm: string; band: string; sortOrder: number };
export type GradeCatalogEntry = Omit<GradeLevel, 'id' | 'campusId'>;
export type Term = { id: string; academicYearId: string; name: string; periodType: 'term' | 'semester'; startDate: string; endDate: string; isCurrent: boolean };
export type Subject = { id: string; campusId: string; code: string; nameEn: string; nameAm: string; category: string };
export type SchoolCalendarEntry = {
  id: string; campusId: string; academicYearId: string | null;
  entryType: 'holiday' | 'event' | 'exam' | 'closure'; titleEn: string; titleAm: string;
  startDate: string; endDate: string; isNonInstructionalDay: boolean;
  notesEn: string; notesAm: string
};
export type CurriculumUnit = {
  id: string; campusId: string; academicYearId: string; gradeLevelId: string;
  subjectId: string; stream: 'all' | 'natural_science' | 'social_science';
  unitNumber: number; titleEn: string; titleAm: string;
  learningOutcomesEn: string; learningOutcomesAm: string;
  plannedStart: string | null; plannedEnd: string | null;
  gradeName?: string; subjectName?: string
};
export type LessonPlan = {
  id: string; campusId: string; academicYearId: string; teachingAssignmentId: string;
  curriculumUnitId: string | null; plannedOn: string;
  titleEn: string; titleAm: string; objectivesEn: string; objectivesAm: string;
  activitiesEn: string; activitiesAm: string; resources: string;
  status: 'planned' | 'completed' | 'cancelled'; sectionId: string;
  sectionName: string; subjectId: string; subjectName: string; teacherName: string;
  unitName: string; completedAt: string | null
};
export type PromotionRule = {
  id: string; campusId: string; academicYearId: string; gradeLevelId: string;
  minimumAnnualPercent: number; maximumFailedRequiredSubjects: number; gradeName?: string
};
export type ProgressionEligibility = {
  studentId: string; sourceYearId: string; targetYearId: string; sourceGradeId: string;
  sourceGrade: string; status: 'eligible' | 'ineligible' | 'needs_configuration' | 'missing_results';
  rule: PromotionRule | null; annualAveragePercent: number | null;
  failedRequiredSubjects: { subjectId: string; subjectName: string; percent: number }[];
  reason: string
};
export type GradeSubject = Subject & {
  id: string; gradeLevelId: string; subjectId: string;
  stream: 'all' | 'natural_science' | 'social_science';
  weeklyPeriods: number; isRequired: boolean
};
export type Department = { id: string; campusId: string; name: string; description: string };
export type StaffMember = {
  id: string; campusId: string; userId: string | null; departmentId: string | null;
  givenNameEn: string; fatherNameEn: string; grandfatherNameEn: string;
  givenNameAm: string; fatherNameAm: string; grandfatherNameAm: string;
  jobTitle: string; qualification: string; employmentStatus: string; hiredOn: string | null;
  name: string; departmentName: string; teachingAssignmentCount: number; homeroomCount: number
};
export type TeachingAssignment = {
  id: string; campusId: string; staffId: string; sectionId: string; subjectId: string;
  dayOfWeek: number | null; periodNumber: number | null; staffName: string; roomId: string | null;
  roomName: string; shift: string; sectionName: string; subjectName: string;
  effectiveStaffId?: string; effectiveStaffName?: string; isSubstitute?: boolean; substitutionDate?: string
};
export type TimetablePeriod = {
  id: string; campusId: string; shift: 'morning' | 'afternoon' | 'evening';
  periodNumber: number; startsAt: string; endsAt: string
};
export type Room = { id: string; campusId: string; name: string; capacity: number | null; isActive: boolean };
export type LeaveRequest = {
  id: string; staffId: string; staffName: string; startDate: string; endDate: string;
  reason: string; status: 'pending' | 'approved' | 'rejected'; reviewNote: string
};
export type StaffAttendance = {
  id: string; staffId: string; name?: string; department?: string; date: string;
  status: string; clockIn: string | null; clockOut: string | null
};
export type StaffMessage = {
  id: string; departmentId: string | null; type: 'handover' | 'announcement';
  title: string; body: string; createdAt?: string
};
export type AdmissionDocument = {
  id: string; admissionId: string; documentType: string; originalName: string;
  mimeType: string; sizeBytes: number; sha256: string; createdAt: string
};
export type Admission = {
  id: string; campusId: string; academicYearId: string; givenNameAm: string;
  fatherNameAm: string; grandfatherNameAm: string; givenNameEn: string;
  fatherNameEn: string; grandfatherNameEn: string; gender: Student['gender'];
  dateOfBirth: string | null; guardianName: string; guardianPhone: string;
  guardianEmail: string | null; gradeLevelId: string; gradeName: string;
  previousSchool: string | null;
  status: 'enquiry' | 'application' | 'interview' | 'accepted' | 'waitlisted' |
    'rejected' | 'enrolled' | 'withdrawn' | 'transferred_out';
  requiredDocuments: string[]; documentChecklist: { type: string; complete: boolean }[];
  documents: AdmissionDocument[]; interviewAt: string | null; interviewResult: string | null;
  decisionNote: string; sectionId: string | null; studentId: string | null;
  siblingStudentId: string | null; studentNo: string | null
};
export type AdmissionDashboard = {
  total: number; byStatus: Record<string, number>;
  byGrade: { grade: string; total: number; enrolled: number }[]
};

type ApiEnvelope<T> = { data: T };
type PendingOperation = { id: string; ownerId: string; path: string; body: Record<string, unknown>; createdAt: number };

async function offlineDb() {
  return openDB('sims-offline', 1, {
    upgrade(db) { db.createObjectStore('operations', { keyPath: 'id' }); }
  });
}

export function setAccessToken(token: string | null) {
  accessToken = token;
  accessTokenVersion += 1;
}

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST', credentials: 'include'
      });
      if (!response.ok) throw new Error(`Session refresh failed (${response.status}).`);
      const payload = await response.json() as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(payload.data.accessToken);
      return payload.data.accessToken;
    })().catch((error: unknown) => {
      setAccessToken(null);
      throw error;
    }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function fetchWithRefresh(path: string, init: RequestInit, allowRefresh = true): Promise<Response> {
  const headers = new Headers(init.headers);
  const requestTokenVersion = accessTokenVersion;
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && allowRefresh &&
      path !== '/api/auth/login' && path !== '/api/auth/refresh') {
    if (accessTokenVersion !== requestTokenVersion) {
      if (!accessToken) return response;
    } else await refreshAccessToken();
    headers.set('Authorization', `Bearer ${accessToken}`);
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  }
  return response;
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetchWithRefresh(path, { ...init, headers }, allowRefresh);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    Object.assign(error, { status: response.status, code: payload?.error?.code });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json() as ApiEnvelope<T>;
  return payload.data;
}
async function requestText(path: string): Promise<string> {
  const response = await fetchWithRefresh(path, {});
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.text();
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetchWithRefresh(path, {});
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.blob();
}

export const api = {
  auditLog: (filters: AuditFilters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    return request<AuditPage>(`/api/audit-log?${params.toString()}`);
  },
  loginHistory: (filters: AuditFilters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    return request<AuditPage>(`/api/login-history?${params.toString()}`);
  },
  exportAuditLog: async (filters: AuditFilters) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    const response = await fetchWithRefresh(`/api/audit-log.csv?${params.toString()}`, {});
    if (!response.ok) throw new Error(`Audit export failed (${response.status}).`);
    return response.blob();
  },
  activeSessions: () => request<ActiveSession[]>('/api/audit-sessions'),
  revokeSession: (sessionId: string) =>
    request<void>(`/api/audit-sessions/${sessionId}`, { method: 'DELETE' }),
  platformDashboard: () => request<PlatformDashboard>('/api/platform'),
  createPlatformSchool: (body: PlatformSchoolDraft) =>
    request<PlatformSchoolProvisioning>('/api/platform/schools', {
      method: 'POST', body: JSON.stringify(body)
    }),
  regenerateSchoolAdministratorInvitation: (organizationId: string) =>
    request<AccountInvitation>(
      `/api/platform/schools/${organizationId}/admin-invitation/regenerate`, {
        method: 'POST', body: JSON.stringify({})
      }
    ),
  saveSubscriptionPlan: (plan: SubscriptionPlan) =>
    request<SubscriptionPlan>(`/api/platform/subscription-plans/${encodeURIComponent(plan.code)}`, {
      method: 'PUT', body: JSON.stringify(plan)
    }),
  updateSchoolStatus: (organizationId: string, status: 'active' | 'suspended') =>
    request<OrganizationSettings>(`/api/platform/schools/${organizationId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  assignSchoolPlan: (organizationId: string, planCode: string) =>
    request<SchoolSubscription>(`/api/platform/schools/${organizationId}/plan`, {
      method: 'PUT', body: JSON.stringify({ planCode })
    }),
  platformSchoolSubscription: (organizationId: string) =>
    request<SchoolSubscription>(`/api/platform/schools/${organizationId}/subscription`),
  createSubscriptionInvoice: (organizationId: string, amount: number, currencyCode: string) =>
    request<{ id: string; invoiceNumber: string; amount: number; currencyCode: string; status: string }>(
      `/api/platform/schools/${organizationId}/invoices`, {
        method: 'POST', body: JSON.stringify({ amount, currencyCode })
      }
    ),
  recordSubscriptionPayment: (invoiceId: string, amount: number, receivedOn: string, reference: string) =>
    request<{ id: string; invoiceId: string; amount: number }>(
      `/api/platform/subscription-invoices/${invoiceId}/payments`, {
        method: 'POST', body: JSON.stringify({ amount, receivedOn, reference })
      }
    ),
  refundSubscriptionPayment: (paymentId: string, amount: number, reason: string) =>
    request<{ id: string; paymentId: string; amount: number }>(
      `/api/platform/subscription-payments/${paymentId}/refunds`, {
        method: 'POST', body: JSON.stringify({ amount, reason })
      }
    ),
  platformSettings: () => request<PlatformSettings>('/api/platform/settings'),
  updatePlatformSettings: (body: Partial<PlatformSettings> & { smtpPassword?: string }) =>
    request<PlatformSettings>('/api/platform/settings', {
      method: 'PUT', body: JSON.stringify(body)
    }),
  supportTickets: (mode: 'customer' | 'internal' | 'platform',
    filters: { search?: string; status?: string; priority?: string; page?: number; pageSize?: number } = {}) => {
    const path = mode === 'customer' ? '/api/support/tickets'
      : mode === 'internal' ? '/api/school/it-tickets' : '/api/platform/support/tickets';
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    return request<SupportTicket[]>(`${path}?${params.toString()}`);
  },
  supportAssignees: () => request<SupportAssignee[]>('/api/platform/support/assignees'),
  createSupportTicket: (mode: 'customer' | 'internal',
    body: Pick<SupportTicket, 'subject' | 'category' | 'priority'>) =>
    request<SupportTicket>(mode === 'customer' ? '/api/support/tickets' : '/api/school/it-tickets', {
      method: 'POST', body: JSON.stringify(body)
    }),
  getSupportTicket: (mode: 'customer' | 'internal' | 'platform', id: string) => {
    const base = mode === 'customer' ? '/api/support/tickets'
      : mode === 'internal' ? '/api/school/it-tickets' : '/api/platform/support/tickets';
    return request<SupportTicket>(`${base}/${id}`);
  },
  updateSupportTicket: (mode: 'internal' | 'platform', id: string,
    body: { status?: SupportTicket['status']; assignedTo?: string | null }) => {
    const base = mode === 'internal' ? '/api/school/it-tickets' : '/api/platform/support/tickets';
    return request<SupportTicket>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },
  commentSupportTicket: (mode: 'customer' | 'internal' | 'platform', id: string,
    body: { body: string }) => {
    const base = mode === 'customer' ? '/api/support/tickets'
      : mode === 'internal' ? '/api/school/it-tickets' : '/api/platform/support/tickets';
    return request<{ id: string }>(`${base}/${id}/comments`, {
      method: 'POST', body: JSON.stringify(body)
    });
  },
  addPlatformInternalNote: (id: string, body: string) =>
    request<{ id: string }>(`/api/platform/support/tickets/${id}/internal-notes`, {
      method: 'POST', body: JSON.stringify({ body })
    }),
  uploadSupportAttachment: (mode: 'customer' | 'internal' | 'platform', id: string, file: File) => {
    const base = mode === 'customer' ? `/api/support/tickets/${id}/attachments`
      : mode === 'internal' ? `/api/school/it-tickets/${id}/attachments`
        : `/api/platform/support/tickets/${id}/attachments`;
    return request<{ id: string; originalName: string }>(base, {
      method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
      body: file
    });
  },
  downloadSupportAttachment: async (mode: 'customer' | 'internal' | 'platform', id: string) => {
    const path = mode === 'customer' ? `/api/support/attachments/${id}`
      : mode === 'internal' ? `/api/school/it-attachments/${id}`
        : `/api/platform/support/attachments/${id}`;
    const response = await fetchWithRefresh(path, {});
    if (!response.ok) throw new Error(`Attachment download failed (${response.status}).`);
    return response.blob();
  },
  platformMonitoring: () => request<PlatformMonitoring>('/api/platform/monitoring'),
  platformBackupHistory: () => request<BackupRun[]>('/api/platform/backups'),
  emailIntegrationStatus: () =>
    request<{
      configured: boolean; fromAddress: string | null; emailAddress: string | null;
      emailVerified: boolean;
      lastTestResult: { result: 'succeeded' | 'failed'; testedAt: string; errorCode: string | null } | null
    }>('/api/school/integrations/email'),
  requestEmailVerification: () =>
    request<{ sent: boolean; verified?: boolean }>('/api/school/integrations/email/verification', {
      method: 'POST', body: JSON.stringify({})
    }),
  confirmEmailVerification: (token: string) =>
    request<{ verified: boolean }>('/api/school/integrations/email/verification/confirm', {
      method: 'POST', body: JSON.stringify({ token })
    }),
  sendIntegrationTestEmail: () =>
    request<{ sent: boolean }>('/api/school/integrations/email/test', {
      method: 'POST', body: JSON.stringify({})
    }),
  uploadSchoolLogo: (organizationId: string, file: File) =>
    request<{ mimeType: string; sizeBytes: number }>(
      `/api/platform/schools/${organizationId}/logo`, {
        method: 'PUT', headers: { 'Content-Type': file.type }, body: file
      }
    ),
  exportSubscriptionRevenue: async () => {
    const response = await fetchWithRefresh('/api/platform/reports/revenue.csv', {});
    if (!response.ok) throw new Error(`Revenue export failed (${response.status}).`);
    return response.blob();
  },
  platformOutstandingReport: (range: { from?: string; to?: string }) => {
    const query = new URLSearchParams();
    if (range.from) query.set('from', range.from);
    if (range.to) query.set('to', range.to);
    return request<PlatformOutstandingReport>(
      `/api/platform/reports/outstanding${query.size ? `?${query}` : ''}`
    );
  },
  exportSubscriptionOutstanding: async (range: { from?: string; to?: string }) => {
    const query = new URLSearchParams();
    if (range.from) query.set('from', range.from);
    if (range.to) query.set('to', range.to);
    const response = await fetchWithRefresh(
      `/api/platform/reports/outstanding.csv${query.size ? `?${query}` : ''}`, {}
    );
    if (!response.ok) throw new Error(`Outstanding balance export failed (${response.status}).`);
    return response.blob();
  },
  closureRequests: () => request<OrganizationClosure[]>('/api/platform/closures'),
  approveClosure: (closureId: string, retentionDays: number, financialRetentionDays: number) =>
    request<OrganizationClosure>(`/api/platform/closures/${closureId}/approve`, {
      method: 'POST', body: JSON.stringify({ retentionDays, financialRetentionDays })
    }),
  pseudonymizeClosure: (closureId: string) =>
    request<{ id: string; status: string; pseudonymizedAt: string; students: number }>(
      `/api/platform/closures/${closureId}/pseudonymize`, {
        method: 'POST', body: JSON.stringify({ confirmation: 'PSEUDONYMIZE' })
      }
    ),
  schoolSettings: () => request<OrganizationSettings>('/api/school/settings'),
  updateSchoolSettings: (body: Pick<OrganizationSettings, 'preferredLocale' | 'currencyCode' | 'branding'>) =>
    request<OrganizationSettings>('/api/school/settings', { method: 'PUT', body: JSON.stringify(body) }),
  schoolBranches: () => request<OrganizationBranch[]>('/api/school/branches'),
  createSchoolBranch: (body: Pick<OrganizationBranch, 'name' | 'address' | 'phone'>) =>
    request<OrganizationBranch>('/api/school/branches', { method: 'POST', body: JSON.stringify(body) }),
  updateSchoolBranch: (branchId: string, body: Partial<Pick<OrganizationBranch, 'name' | 'isActive'>>) =>
    request<OrganizationBranch>(`/api/school/branches/${branchId}`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  switchBranch: async (campusId: string) => {
    const data = await request<{ accessToken: string; user: User }>('/api/auth/switch-branch', {
      method: 'POST', body: JSON.stringify({ campusId })
    });
    setAccessToken(data.accessToken);
    return data.user;
  },
  schoolSubscription: () => request<SchoolSubscription | null>('/api/school/subscription'),
  requestSchoolClosure: (reason: string) =>
    request<{ id: string; status: string }>('/api/school/closure', {
      method: 'POST', body: JSON.stringify({ reason })
    }),
  exportSchoolData: () => requestBlob('/api/school/export'),
  login: async (login: string, password: string) => {
    const data = await request<{ accessToken: string; user: User }>('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ login, password })
    }, false);
    setAccessToken(data.accessToken);
    return data.user;
  },
  requestPasswordReset: (email: string) =>
    request<{ message: string }>('/api/auth/password/forgot', {
      method: 'POST', body: JSON.stringify({ email })
    }, false),
  resetPassword: (token: string, password: string, confirmPassword: string) =>
    request<void>('/api/auth/password/reset', {
      method: 'POST', body: JSON.stringify({ token, password, confirmPassword })
    }, false),
  accounts: () => request<SchoolAccount[]>('/api/accounts'),
  setAccountActive: (userId: string, isActive: boolean) =>
    request<SchoolAccount>(`/api/accounts/${userId}/status`, {
      method: 'PATCH', body: JSON.stringify({ isActive })
    }),
  roles: () => request<RoleCatalog>('/api/roles'),
  createRole: (name: string, permissions: string[]) =>
    request<ManagedRole>('/api/roles', {
      method: 'POST', body: JSON.stringify({ name, permissions })
    }),
  updateRolePermissions: (roleKey: string, permissions: string[]) =>
    request<ManagedRole>(`/api/roles/${encodeURIComponent(roleKey)}/permissions`, {
      method: 'PUT', body: JSON.stringify({ permissions })
    }),
  assignAccountRole: (userId: string, role: string) =>
    request<SchoolAccount>(`/api/accounts/${userId}/role`, {
      method: 'PUT', body: JSON.stringify({ role })
    }),
  accountPermissions: (userId: string) =>
    request<EffectivePermissions>(`/api/accounts/${userId}/permissions`),
  platformUsers: () => request<PlatformUser[]>('/api/platform/users'),
  invitePlatformUser: (name: string, email: string) =>
    request<AccountInvitation>('/api/platform/users/invitations', {
      method: 'POST', body: JSON.stringify({ name, email, role: 'super_admin' })
    }),
  updatePlatformUser: (userId: string, body: { name?: string; email?: string }) =>
    request<PlatformUser>(`/api/platform/users/${userId}`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  setPlatformUserActive: (userId: string, isActive: boolean) =>
    request<PlatformUser>(`/api/platform/users/${userId}/status`, {
      method: 'PATCH', body: JSON.stringify({ isActive })
    }),
  assignPlatformRole: (userId: string, role: 'super_admin') =>
    request<PlatformUser>(`/api/platform/users/${userId}/role`, {
      method: 'PUT', body: JSON.stringify({ role })
    }),
  me: () => {
    if (!currentUserPromise) {
      currentUserPromise = request<User>('/api/auth/me').finally(() => {
        currentUserPromise = null;
      });
    }
    return currentUserPromise;
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const data = await request<{ accessToken: string; user: User }>('/api/auth/password/change', {
      method: 'POST', body: JSON.stringify({ currentPassword, newPassword })
    });
    setAccessToken(data.accessToken);
    return data.user;
  },
  invitationDetails: (token: string) =>
    request<InvitationDetails>(`/api/auth/invitations/${encodeURIComponent(token)}`, {}, false),
  acceptInvitation: async (token: string, password: string) => {
    const data = await request<{ accessToken: string; user: User }>('/api/auth/invitations/accept', {
      method: 'POST', body: JSON.stringify({ token, password })
    }, false);
    setAccessToken(data.accessToken);
    return data.user;
  },
  createAccountInvitation: (body: {
    targetType: 'staff' | 'student' | 'guardian'; targetId: string; email: string;
    role?: StaffInvitationRole
  }) => request<AccountInvitation>('/api/account-invitations', {
    method: 'POST', body: JSON.stringify(body)
  }),
  verifyStudentGuardian: (studentId: string, guardianId: string, body: {
    isVerified: boolean; canViewResults: boolean; canViewFees: boolean
  }) => request<{ studentId: string; guardianId: string; isVerified: boolean; canViewResults: boolean; canViewFees: boolean }>(
    `/api/students/${studentId}/guardians/${guardianId}/access`, { method: 'PATCH', body: JSON.stringify(body) }
  ),
  portalHome: () => request<PortalHome>('/api/portal/home'),
  portalCalendar: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<PortalCalendar>(`/api/portal/calendar${params.size ? `?${params}` : ''}`);
  },
  portalRequests: () => request<PortalRequest[]>('/api/portal/requests'),
  createPortalRequest: (body: Pick<PortalRequest, 'studentId' | 'type' | 'subject' | 'details'>) =>
    request<PortalRequest>('/api/portal/requests', { method: 'POST', body: JSON.stringify(body) }),
  updatePortalRequest: (id: string, body: { status: string; response: string }) =>
    request<PortalRequest>(`/api/portal/requests/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  portalSupportRequests: () => request<PortalRequest[]>('/api/portal/support'),
  createPortalSupportRequest: (body: {
    studentId?: string; category: 'academic' | 'technical'; subject: string; details: string
  }) => request<PortalRequest>('/api/portal/support', { method: 'POST', body: JSON.stringify(body) }),
  updatePortalSupportRequest: (id: string, body: { status: string; response: string }) =>
    request<PortalRequest>(`/api/portal/support/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  portalMessageThreads: () => request<PortalMessageThread[]>('/api/portal/messages/threads'),
  createPortalMessageThread: (body: { studentId: string; recipientId: string; body: string }) =>
    request<PortalMessage>('/api/portal/messages/threads', { method: 'POST', body: JSON.stringify(body) }),
  sendPortalThreadMessage: (threadId: string, body: string) =>
    request<PortalMessage>(`/api/portal/messages/threads/${threadId}/messages`, {
      method: 'POST', body: JSON.stringify({ body })
    }),
  markPortalThreadRead: (threadId: string) =>
    request<{ threadId: string; readAt: string }>(`/api/portal/messages/threads/${threadId}/read`, { method: 'PATCH' }),
  moderatePortalMessage: (messageId: string, body: { status: 'visible' | 'archived'; reason: string }) =>
    request<PortalMessage>(`/api/portal/messages/${messageId}/moderation`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  portalMessagingSettings: () => request<{ messagingEnabled: boolean }>('/api/school/messaging-settings'),
  setPortalMessagingEnabled: (messagingEnabled: boolean) =>
    request<{ messagingEnabled: boolean }>('/api/school/messaging-settings', {
      method: 'PUT', body: JSON.stringify({ messagingEnabled })
    }),
  updateCampusEventStatus: (eventId: string, status: 'cancelled' | 'archived' | 'published') =>
    request<CampusEvent>(`/api/communications/events/${eventId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  logout: async () => {
    await request<void>('/api/auth/logout', { method: 'POST' }, false).catch(() => undefined);
    setAccessToken(null);
  },
  dashboard: () => request<Dashboard>('/api/dashboard'),
  hrDashboard: () => request<HrDashboard>('/api/hr/dashboard'),
  inventoryDashboard: () => request<InventoryDashboard>('/api/inventory/dashboard'),
  frontDeskDashboard: () => request<FrontDeskDashboard>('/api/front-desk/dashboard'),
  frontDeskVisitors: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskVisitor[]>(`/api/front-desk/visitors?${params}`);
  },
  createFrontDeskVisitor: (body: { visitorName: string; purpose: string; hostStaffId?: string | null }) =>
    request<FrontDeskVisitor>('/api/front-desk/visitors', { method: 'POST', body: JSON.stringify(body) }),
  checkoutFrontDeskVisitor: (id: string) =>
    request<FrontDeskVisitor>(`/api/front-desk/visitors/${id}/checkout`, { method: 'POST' }),
  frontDeskAppointments: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskAppointment[]>(`/api/front-desk/appointments?${params}`);
  },
  createFrontDeskAppointment: (body: {
    parentName: string; studentId?: string | null; staffId: string;
    appointmentAt: string; purpose: string
  }) => request<FrontDeskAppointment>('/api/front-desk/appointments', {
    method: 'POST', body: JSON.stringify(body)
  }),
  updateFrontDeskAppointmentStatus: (id: string, status: 'confirmed' | 'completed' | 'cancelled') =>
    request<FrontDeskAppointment>(`/api/front-desk/appointments/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  frontDeskMessages: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskMessage[]>(`/api/front-desk/messages?${params}`);
  },
  createFrontDeskMessage: (body: {
    senderName: string; recipientStaffId: string; subject: string; message: string
  }) => request<FrontDeskMessage>('/api/front-desk/messages', { method: 'POST', body: JSON.stringify(body) }),
  updateFrontDeskMessageStatus: (id: string, status: 'read' | 'resolved') =>
    request<FrontDeskMessage>(`/api/front-desk/messages/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  frontDeskAuthorizations: (query: { page?: number; pageSize?: number; studentId?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskAuthorization[]>(`/api/front-desk/pickup/authorizations?${params}`);
  },
  createFrontDeskAuthorization: (body: {
    studentId: string; guardianName: string; relationship: string; phone?: string;
    authorizationType: 'regular' | 'temporary'; oneTime: boolean; expiresAt: string | null
  }) => request<FrontDeskAuthorization>('/api/front-desk/pickup/authorizations', {
    method: 'POST', body: JSON.stringify(body)
  }),
  updateFrontDeskAuthorizationStatus: (id: string, status: 'removed' | 'expired') =>
    request<FrontDeskAuthorization>(`/api/front-desk/pickup/authorizations/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  frontDeskPickupReleases: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskPickupEvent[]>(`/api/front-desk/pickup/releases?${params}`);
  },
  frontDeskPickupAttempts: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskPickupAttempt[]>(`/api/front-desk/pickup/attempts?${params}`);
  },
  releaseFrontDeskPickup: (body: {
    studentId: string; personName: string; authorizationId: string; occasionKey: string;
    verificationNote?: string; confirmOneTime: boolean
  }) => request<FrontDeskPickupEvent>(`/api/front-desk/pickup/releases`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  correctFrontDeskPickup: (id: string, body: { reason: string; note?: string }) =>
    request<FrontDeskPickupEvent>(`/api/front-desk/pickup/releases/${id}/corrections`, {
      method: 'POST', body: JSON.stringify(body)
    }),
  frontDeskDeliveries: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskDelivery[]>(`/api/front-desk/deliveries?${params}`);
  },
  createFrontDeskDelivery: (body: { recipientName: string; recipientStaffId?: string | null; description: string }) =>
    request<FrontDeskDelivery>('/api/front-desk/deliveries', { method: 'POST', body: JSON.stringify(body) }),
  updateFrontDeskDeliveryStatus: (id: string, status: 'collected' | 'returned') =>
    request<FrontDeskDelivery>(`/api/front-desk/deliveries/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  frontDeskLostFound: (query: { page?: number; pageSize?: number } = {}) => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    return request<FrontDeskLostFound[]>(`/api/front-desk/lost-found?${params}`);
  },
  createFrontDeskLostFound: (body: { description: string; locationFound: string; foundAt: string }) =>
    request<FrontDeskLostFound>('/api/front-desk/lost-found', { method: 'POST', body: JSON.stringify(body) }),
  updateFrontDeskLostFoundStatus: (id: string, body: { status: 'claimed' | 'disposed'; claimedBy?: string }) =>
    request<FrontDeskLostFound>(`/api/front-desk/lost-found/${id}/status`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  frontDeskSettings: () => request<FrontDeskSettings>('/api/front-desk/settings'),
  updateFrontDeskSettings: (body: FrontDeskSettings) =>
    request<FrontDeskSettings>('/api/front-desk/settings', { method: 'PUT', body: JSON.stringify(body) }),
  inventoryCategories: () => request<InventoryCategory[]>('/api/inventory/categories'),
  createInventoryCategory: (body: { name: string }) =>
    request<InventoryCategory>('/api/inventory/categories', { method: 'POST', body: JSON.stringify(body) }),
  inventorySuppliers: (filters: { search?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<InventorySupplier[]>(`/api/inventory/suppliers${query.size ? `?${query}` : ''}`);
  },
  createInventorySupplier: (body: Omit<InventorySupplier, 'id' | 'status'>) =>
    request<InventorySupplier>('/api/inventory/suppliers', { method: 'POST', body: JSON.stringify(body) }),
  inventoryItems: (filters: { search?: string; categoryId?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<InventoryItem[]>(`/api/inventory/items${query.size ? `?${query}` : ''}`);
  },
  createInventoryItem: (body: Omit<InventoryItem, 'id' | 'currentQuantity' | 'averageUnitCostMinor' | 'status' | 'lowStock'>) =>
    request<InventoryItem>('/api/inventory/items', { method: 'POST', body: JSON.stringify(body) }),
  updateInventoryItem: (id: string, body: Partial<Omit<InventoryItem, 'id' | 'currentQuantity' | 'averageUnitCostMinor'>>) =>
    request<InventoryItem>(`/api/inventory/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveInventoryItem: (id: string) =>
    request<InventoryItem>(`/api/inventory/items/${id}/archive`, { method: 'POST' }),
  inventoryPurchases: (filters: { search?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<InventoryPurchase[]>(`/api/inventory/purchases${query.size ? `?${query}` : ''}`);
  },
  createInventoryPurchase: (body: {
    purchaseNumber: string; supplierId: string; purchasedOn: string; expectedOn: string | null;
    currencyCode: string; notes: string;
    lines: { itemId: string; quantity: number; unitCostMinor: number }[]
  }) => request<InventoryPurchase>('/api/inventory/purchases', {
    method: 'POST', body: JSON.stringify(body)
  }),
  updateInventoryPurchase: (id: string, body: {
    purchaseNumber: string; supplierId: string; purchasedOn: string; expectedOn: string | null;
    currencyCode: string; notes: string;
    lines: { itemId: string; quantity: number; unitCostMinor: number }[]
  }) => request<InventoryPurchase>(`/api/inventory/purchases/${id}`, {
    method: 'PATCH', body: JSON.stringify(body)
  }),
  setInventoryPurchaseStatus: (id: string, status: 'ordered' | 'cancelled') =>
    request<InventoryPurchase>(`/api/inventory/purchases/${id}/status`, {
      method: 'POST', body: JSON.stringify({ status })
    }),
  receiveInventoryPurchase: (id: string, body: {
    idempotencyKey: string; receivedOn: string;
    lines: { purchaseLineId: string; quantity: number }[]
  }) => request<{ id: string; purchaseId: string }>(`/api/inventory/purchases/${id}/receipts`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  inventoryMovements: (filters: { search?: string; itemId?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<InventoryMovement[]>(`/api/inventory/movements${query.size ? `?${query}` : ''}`);
  },
  createInventoryMovement: (body: {
    itemId: string; movementType: 'in' | 'out' | 'adjustment'; quantity: number;
    unitCostMinor: number; movedOn: string; reason: string; idempotencyKey: string
  }) => request<InventoryMovement>('/api/inventory/movements', {
    method: 'POST', body: JSON.stringify(body)
  }),
  inventoryAssets: (filters: { search?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<FixedAsset[]>(`/api/inventory/assets${query.size ? `?${query}` : ''}`);
  },
  createFixedAsset: (body: Omit<FixedAsset, 'id' | 'status' | 'allocation'>) =>
    request<FixedAsset>('/api/inventory/assets', { method: 'POST', body: JSON.stringify(body) }),
  updateFixedAsset: (id: string, body: Partial<Omit<FixedAsset, 'id' | 'status' | 'allocation'>>) =>
    request<FixedAsset>(`/api/inventory/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveFixedAsset: (id: string) =>
    request<FixedAsset>(`/api/inventory/assets/${id}/archive`, { method: 'POST' }),
  setFixedAssetStatus: (id: string, body: { status: 'lost' | 'disposed'; reason: string; changedOn: string }) =>
    request<FixedAsset>(`/api/inventory/assets/${id}/status`, { method: 'POST', body: JSON.stringify(body) }),
  inventoryAllocations: (status?: string) =>
    request<AssetAllocation[]>(`/api/inventory/allocations${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  allocateFixedAsset: (id: string, body: {
    staffId: string | null; roomId: string | null; allocatedOn: string; notes: string
  }) => request<AssetAllocation>(`/api/inventory/assets/${id}/allocations`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  returnFixedAsset: (id: string, returnedOn: string) =>
    request<AssetAllocation>(`/api/inventory/allocations/${id}/return`, {
      method: 'POST', body: JSON.stringify({ returnedOn })
    }),
  addAssetMaintenance: (id: string, body: {
    maintenanceOn: string; note: string; costMinor: number; currencyCode: string
  }) => request(`/api/inventory/assets/${id}/maintenance`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  myAllocatedAssets: () => request<AssetAllocation[]>('/api/inventory/my-assets'),
  libraryDashboard: () => request<{ total: number; available: number; borrowed: number; overdue: number }>('/api/library/dashboard'),
  libraryCategories: () => request<LibraryCategory[]>('/api/library/categories'),
  createLibraryCategory: (body: { name: string }) =>
    request<LibraryCategory>('/api/library/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateLibraryCategory: (id: string, body: Partial<Pick<LibraryCategory, 'name'>>) =>
    request<LibraryCategory>(`/api/library/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  libraryBooks: (filters: { search?: string; categoryId?: string; status?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<LibraryBook[]>(`/api/library/books${query.size ? `?${query}` : ''}`);
  },
  createLibraryBook: (body: Omit<LibraryBook, 'id' | 'status' | 'copies'>) =>
    request<LibraryBook>('/api/library/books', { method: 'POST', body: JSON.stringify(body) }),
  updateLibraryBook: (id: string, body: Partial<Omit<LibraryBook, 'id' | 'status' | 'copies'>>) =>
    request<LibraryBook>(`/api/library/books/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveLibraryBook: (id: string) =>
    request<LibraryBook>(`/api/library/books/${id}/archive`, { method: 'POST' }),
  libraryCopies: (filters: { search?: string; categoryId?: string; status?: string; barcode?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request<LibraryCopy[]>(`/api/library/copies${query.size ? `?${query}` : ''}`);
  },
  libraryCopyByBarcode: (barcode: string) =>
    request<LibraryCopy>(`/api/library/barcodes/${encodeURIComponent(barcode)}`),
  createLibraryCopy: (body: Omit<LibraryCopy, 'id' | 'status' | 'book'>) =>
    request<LibraryCopy>('/api/library/copies', { method: 'POST', body: JSON.stringify(body) }),
  updateLibraryCopy: (id: string, body: Partial<Pick<LibraryCopy, 'barcode' | 'copyNumber' | 'condition' | 'shelfLocation'>>) =>
    request<LibraryCopy>(`/api/library/copies/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveLibraryCopy: (id: string) =>
    request<LibraryCopy>(`/api/library/copies/${id}/archive`, { method: 'POST' }),
  libraryMembers: () => request<LibraryMember[]>('/api/library/members'),
  addLibraryMember: (body: { memberType: 'student' | 'staff'; studentId?: string; staffId?: string }) =>
    request<LibraryMember>('/api/library/members', { method: 'POST', body: JSON.stringify(body) }),
  librarySettings: () => request<LibrarySettings>('/api/library/settings'),
  updateLibrarySettings: (body: LibrarySettings) =>
    request<LibrarySettings>('/api/library/settings', { method: 'PUT', body: JSON.stringify(body) }),
  libraryLoans: (status?: string) =>
    request<LibraryLoan[]>(`/api/library/loans${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  issueLibraryCopy: (body: { copyId: string; memberId: string; issuedOn: string; idempotencyKey: string }) =>
    request<LibraryLoan>('/api/library/loans', { method: 'POST', body: JSON.stringify(body) }),
  returnLibraryLoan: (id: string, body: { returnCondition: string; returnedOn: string }) =>
    request<LibraryLoan>(`/api/library/loans/${id}/return`, { method: 'POST', body: JSON.stringify(body) }),
  renewLibraryLoan: (id: string) =>
    request<LibraryLoan>(`/api/library/loans/${id}/renew`, { method: 'POST', body: JSON.stringify({}) }),
  libraryReservations: () => request<LibraryReservation[]>('/api/library/reservations'),
  reserveLibraryBook: (body: { bookId: string; memberId: string; idempotencyKey: string }) =>
    request<LibraryReservation>('/api/library/reservations', { method: 'POST', body: JSON.stringify(body) }),
  cancelLibraryReservation: (id: string) =>
    request<LibraryReservation>(`/api/library/reservations/${id}/cancel`, { method: 'POST' }),
  libraryFines: () => request<LibraryFine[]>('/api/library/fines'),
  payLibraryFine: (id: string, paidOn: string) =>
    request<LibraryFine>(`/api/library/fines/${id}/pay`, { method: 'POST', body: JSON.stringify({ status: 'paid', paidOn }) }),
  waiveLibraryFine: (id: string, reason: string) =>
    request<LibraryFine>(`/api/library/fines/${id}/waive`, { method: 'POST', body: JSON.stringify({ reason }) }),
  portalLibrary: () => request<PortalLibrary>('/api/portal/library'),
  payrollDashboard: () => request<PayrollDashboard>('/api/payroll/dashboard'),
  payrollRules: () => request<PayrollRule[]>('/api/payroll/rules'),
  createPayrollRule: (body: {
    code: string; name: string; kind: 'tax' | 'pension';
    configuration: PayrollRule['configuration']; idempotencyKey: string
  }) => request<PayrollRule>('/api/payroll/rules', {
    method: 'POST', body: JSON.stringify(body)
  }),
  payrollSalaryStructures: (staffId?: string) =>
    request<PayrollSalaryStructure[]>(`/api/payroll/structures${
      staffId ? `?staffId=${encodeURIComponent(staffId)}` : ''}`),
  createPayrollSalaryStructure: (body: {
    staffId: string; currencyCode: string; basicSalaryMinor: number;
    allowances: { code: string; name: string; amountMinor: number }[];
    deductions: { code: string; name: string; amountMinor: number }[];
    taxRuleId?: string | null; pensionRuleId?: string | null;
    overtimeRateMinorPerHour: number; effectiveFrom: string;
    effectiveTo?: string | null; idempotencyKey: string
  }) => request<PayrollSalaryStructure>('/api/payroll/structures', {
    method: 'POST', body: JSON.stringify(body)
  }),
  updatePayrollSalaryStructure: (id: string, body: Partial<Pick<PayrollSalaryStructure,
    'currencyCode' | 'basicSalaryMinor' | 'allowances' | 'deductions' | 'taxRuleId' |
    'pensionRuleId' | 'overtimeRateMinorPerHour' | 'effectiveTo' | 'status'>>) =>
    request<PayrollSalaryStructure>(`/api/payroll/structures/${id}`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  payrollPeriods: () => request<PayrollPeriod[]>('/api/payroll/periods'),
  createPayrollPeriod: (body: {
    code: string; startsOn: string; endsOn: string; idempotencyKey: string
  }) => request<PayrollPeriod>('/api/payroll/periods', {
    method: 'POST', body: JSON.stringify(body)
  }),
  openPayrollPeriod: (id: string) =>
    request<PayrollPeriod>(`/api/payroll/periods/${id}/open`, { method: 'POST' }),
  payrollInputs: (periodId: string) =>
    request<PayrollInput[]>(`/api/payroll/periods/${periodId}/inputs`),
  loadPayrollInputs: (periodId: string) =>
    request<PayrollInput[]>(`/api/payroll/periods/${periodId}/inputs/load`, { method: 'POST' }),
  updatePayrollInput: (periodId: string, staffId: string, body: {
    attendanceDays: number; overtimeMinutes: number; bonusMinor: number;
    adjustmentMinor: number; adjustmentReason: string
  }) => request<PayrollInput>(`/api/payroll/periods/${periodId}/inputs/${staffId}`, {
    method: 'PUT', body: JSON.stringify(body)
  }),
  createPayrollAdjustment: (periodId: string, body: {
    staffId: string; sourceLineId?: string | null; idempotencyKey: string;
    amountMinor: number; reason: string
  }) => request(`/api/payroll/periods/${periodId}/adjustments`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  createPayrollRun: (periodId: string, idempotencyKey: string) =>
    request<PayrollRun>(`/api/payroll/periods/${periodId}/runs`, {
      method: 'POST', body: JSON.stringify({ idempotencyKey })
    }),
  calculatePayrollRun: (runId: string, body: {
    allowNegativeNet?: boolean; overrideReason?: string
  } = {}) => request<PayrollRun>(`/api/payroll/runs/${runId}/calculate`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  payrollRun: (runId: string) => request<PayrollRun>(`/api/payroll/runs/${runId}`),
  submitPayrollRun: (runId: string) =>
    request<PayrollRun>(`/api/payroll/runs/${runId}/submit`, { method: 'POST' }),
  approvePayrollRun: (runId: string, reason: string) =>
    request<PayrollRun>(`/api/payroll/runs/${runId}/approve`, {
      method: 'POST', body: JSON.stringify({ reason })
    }),
  rejectPayrollRun: (runId: string, reason: string) =>
    request<PayrollRun>(`/api/payroll/runs/${runId}/reject`, {
      method: 'POST', body: JSON.stringify({ reason })
    }),
  lockPayrollRun: (runId: string) =>
    request<PayrollRun>(`/api/payroll/runs/${runId}/lock`, { method: 'POST' }),
  recordPayrollPayment: (runId: string, body: {
    lineId: string; idempotencyKey: string; reference: string;
    amountMinor: number; paymentDate: string
  }) => request<PayrollPayment>(`/api/payroll/runs/${runId}/payments`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  generatePayrollPayslips: (runId: string) =>
    request<PayrollPayslip[]>(`/api/payroll/runs/${runId}/payslips`, { method: 'POST' }),
  payrollPayslips: () => request<PayrollPayslip[]>('/api/payroll/payslips'),
  payrollPayslip: (id: string) => request<PayrollPayslip>(`/api/payroll/payslips/${id}`),
  closePayrollRun: (runId: string) =>
    request<PayrollRun>(`/api/payroll/runs/${runId}/close`, { method: 'POST' }),
  updateHrStaff: (id: string, body: Partial<Pick<StaffMember,
    'departmentId' | 'givenNameEn' | 'fatherNameEn' | 'grandfatherNameEn' |
    'givenNameAm' | 'fatherNameAm' | 'grandfatherNameAm' | 'jobTitle' |
    'qualification' | 'employmentStatus' | 'hiredOn'>>) =>
    request<StaffMember>(`/api/hr/staff/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveHrStaff: (id: string) =>
    request<{ id: string; archivedAt: string }>(`/api/hr/staff/${id}/archive`, { method: 'POST' }),
  previewHrStaffImport: async (csv: string) => request<{
    totalRows: number; eligibleCount: number; invalidCount: number;
    rows: { rowNumber: number; eligible: boolean; errors: { field: string; message: string }[] }[]
  }>('/api/hr/staff/import/preview', {
    method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' }
  }),
  commitHrStaffImport: async (csv: string) => request<{
    totalRows: number; createdCount: number; skippedCount: number;
    rows: { rowNumber: number; eligible: boolean; errors: { field: string; message: string }[] }[]
  }>('/api/hr/staff/import/commit', {
    method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' }
  }),
  hrStaffDocuments: (staffId: string) =>
    request<HrDocument[]>(`/api/hr/staff/${staffId}/documents`),
  uploadHrStaffDocument: async (staffId: string, file: File, category: string) => {
    const query = new URLSearchParams({ name: file.name, category });
    const response = await fetchWithRefresh(`/api/hr/staff/${staffId}/documents?${query}`, {
      method: 'POST', body: file, headers: { 'Content-Type': file.type }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    }
    return (await response.json() as ApiEnvelope<HrDocument>).data;
  },
  downloadHrStaffDocument: (staffId: string, documentId: string) =>
    requestBlob(`/api/hr/staff/${staffId}/documents/${documentId}`),
  hrContracts: (staffId?: string) =>
    request<HrContract[]>(`/api/hr/contracts${staffId ? `?staffId=${encodeURIComponent(staffId)}` : ''}`),
  createHrContract: (staffId: string, body: {
    contractType: string; startsOn: string; endsOn?: string | null;
    renewalDueOn?: string | null; notes?: string
  }) => request<HrContract>(`/api/hr/staff/${staffId}/contracts`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  renewHrContract: (id: string, newEndDate: string) =>
    request<{ contract: HrContract }>(`/api/hr/contracts/${id}/renewals`, {
      method: 'POST', body: JSON.stringify({ newEndDate })
    }),
  hrLeaveTypes: () => request<HrLeaveType[]>('/api/hr/leave-types'),
  createHrLeaveType: (body: Omit<HrLeaveType, 'id'>) =>
    request<HrLeaveType>('/api/hr/leave-types', { method: 'POST', body: JSON.stringify(body) }),
  hrLeaveBalances: (filters: { staffId?: string; year?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.staffId) params.set('staffId', filters.staffId);
    if (filters.year) params.set('year', String(filters.year));
    return request<HrLeaveBalance[]>(`/api/hr/leave-balances${params.size ? `?${params}` : ''}`);
  },
  setHrLeaveBalance: (body: {
    staffId: string; leaveTypeId: string; year: number; entitledHalfDays?: number;
    carryOverHalfDays: number
  }) => request<HrLeaveBalance>('/api/hr/leave-balances', {
    method: 'POST', body: JSON.stringify(body)
  }),
  hrVacancies: () => request<HrVacancy[]>('/api/hr/vacancies'),
  createHrVacancy: (body: { departmentId?: string | null; title: string; description: string }) =>
    request<HrVacancy>('/api/hr/vacancies', { method: 'POST', body: JSON.stringify(body) }),
  hrApplicants: (vacancyId?: string) => request<HrApplicant[]>(
    `/api/hr/applicants${vacancyId ? `?vacancyId=${encodeURIComponent(vacancyId)}` : ''}`),
  createHrApplicant: (vacancyId: string, body: {
    givenName: string; fatherName: string; grandfatherName: string; email: string; phone: string
  }) => request<HrApplicant>(`/api/hr/vacancies/${vacancyId}/applicants`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  hrInterviews: (applicantId: string) =>
    request<HrInterview[]>(`/api/hr/applicants/${applicantId}/interviews`),
  scheduleHrInterview: (applicantId: string, body: { scheduledAt: string; notes: string }) =>
    request<HrInterview>(`/api/hr/applicants/${applicantId}/interviews`, {
      method: 'POST', body: JSON.stringify(body)
    }),
  decideHrApplicant: (id: string, body: { decision: 'shortlisted' | 'rejected' | 'hired'; reason: string }) =>
    request<HrApplicant>(`/api/hr/applicants/${id}/decision`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  hrApplicantDocuments: (applicantId: string) =>
    request<HrDocument[]>(`/api/hr/applicants/${applicantId}/documents`),
  uploadHrApplicantDocument: async (applicantId: string, file: File, category: string) => {
    const query = new URLSearchParams({ name: file.name, category });
    const response = await fetchWithRefresh(`/api/hr/applicants/${applicantId}/documents?${query}`, {
      method: 'POST', body: file, headers: { 'Content-Type': file.type }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    }
    return (await response.json() as ApiEnvelope<HrDocument>).data;
  },
  downloadHrApplicantDocument: (applicantId: string, documentId: string) =>
    requestBlob(`/api/hr/applicants/${applicantId}/documents/${documentId}`),
  hrPerformanceCycles: () => request<HrPerformanceCycle[]>('/api/hr/performance/cycles'),
  createHrPerformanceCycle: (body: { name: string; startsOn: string; endsOn: string }) =>
    request<HrPerformanceCycle>('/api/hr/performance/cycles', { method: 'POST', body: JSON.stringify(body) }),
  hrPerformanceGoals: (staffId?: string) =>
    request<HrPerformanceGoal[]>(`/api/hr/performance/goals${staffId ? `?staffId=${encodeURIComponent(staffId)}` : ''}`),
  createHrPerformanceGoal: (body: {
    staffId: string; cycleId: string; title: string; details: string
  }) => request<HrPerformanceGoal>('/api/hr/performance/goals', {
    method: 'POST', body: JSON.stringify(body)
  }),
  hrPerformanceEvaluations: (staffId?: string) =>
    request<HrPerformanceEvaluation[]>(`/api/hr/performance/evaluations${staffId ? `?staffId=${encodeURIComponent(staffId)}` : ''}`),
  createHrPerformanceEvaluation: (body: {
    staffId: string; cycleId: string; rating: number; feedback: string
  }) => request<HrPerformanceEvaluation>('/api/hr/performance/evaluations', {
    method: 'POST', body: JSON.stringify(body)
  }),
  hrTrainingCourses: () => request<HrTrainingCourse[]>('/api/hr/training/courses'),
  createHrTrainingCourse: (body: {
    title: string; description: string; startsOn: string; endsOn: string
  }) => request<HrTrainingCourse>('/api/hr/training/courses', {
    method: 'POST', body: JSON.stringify(body)
  }),
  enrollHrTraining: (courseId: string, staffId: string) =>
    request<HrTrainingEnrollment>(`/api/hr/training/courses/${courseId}/enrollments`, {
      method: 'POST', body: JSON.stringify({ staffId })
    }),
  hrTrainingEnrollments: (courseId: string) =>
    request<HrTrainingEnrollment[]>(`/api/hr/training/courses/${courseId}/enrollments`),
  updateHrTrainingAttendance: (enrollmentId: string, status: 'enrolled' | 'attended' | 'absent') =>
    request<HrTrainingEnrollment>(`/api/hr/training/enrollments/${enrollmentId}/attendance`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  uploadHrTrainingCertificate: async (enrollmentId: string, file: File) => {
    const response = await fetchWithRefresh(`/api/hr/training/enrollments/${enrollmentId}/certificate`, {
      method: 'PUT', body: file, headers: { 'Content-Type': file.type }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    }
    return (await response.json() as ApiEnvelope<HrTrainingEnrollment>).data;
  },
  downloadHrTrainingCertificate: (enrollmentId: string) =>
    requestBlob(`/api/hr/training/enrollments/${enrollmentId}/certificate`),
  reportsCatalog: () => request<ReportDefinition[]>('/api/reports/catalog'),
  reportFilters: () => request<ReportFilterOptions>('/api/reports/filters'),
  report: (reportId: string, filters: ReportQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    return request<ReportResult>(`/api/reports/${encodeURIComponent(reportId)}?${params}`);
  },
  exportReport: (reportId: string, filters: ReportQuery = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
    });
    return requestBlob(`/api/reports/${encodeURIComponent(reportId)}.csv?${params}`);
  },
  school: () => request<SchoolProfile>('/api/school'),
  academicYear: () => request<AcademicYear>('/api/academic-year'),
  academicYears: () => request<AcademicYearRecord[]>('/api/academic-years'),
  createAcademicYear: (body: Omit<AcademicYearRecord, 'id' | 'campusId' | 'status'>) =>
    request<AcademicYearRecord>('/api/academic-years', { method: 'POST', body: JSON.stringify(body) }),
  activateAcademicYear: (yearId: string) =>
    request<AcademicYearRecord>(`/api/academic-years/${yearId}/activate`, { method: 'PATCH' }),
  terms: () => request<Term[]>('/api/terms'),
  createTerm: (body: Pick<Term, 'name' | 'periodType' | 'startDate' | 'endDate'>) =>
    request<Term>('/api/terms', { method: 'POST', body: JSON.stringify(body) }),
  setCurrentTerm: (termId: string) =>
    request<Term>(`/api/terms/${termId}/current`, { method: 'PATCH' }),
  schoolCalendar: (filters: { from?: string; to?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]);
    return request<SchoolCalendarEntry[]>(`/api/school-calendar${params.size ? `?${params}` : ''}`);
  },
  createCalendarEntry: (body: Omit<SchoolCalendarEntry, 'id' | 'campusId'>) =>
    request<SchoolCalendarEntry>('/api/school-calendar', { method: 'POST', body: JSON.stringify(body) }),
  updateCalendarEntry: (id: string, body: Omit<SchoolCalendarEntry, 'id' | 'campusId'>) =>
    request<SchoolCalendarEntry>(`/api/school-calendar/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCalendarEntry: (id: string) =>
    request<void>(`/api/school-calendar/${id}`, { method: 'DELETE' }),
  curriculumUnits: (filters: { academicYearId?: string; gradeLevelId?: string; subjectId?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]);
    return request<CurriculumUnit[]>(`/api/curriculum/units${params.size ? `?${params}` : ''}`);
  },
  createCurriculumUnit: (body: Omit<CurriculumUnit, 'id' | 'campusId' | 'gradeName' | 'subjectName'>) =>
    request<CurriculumUnit>('/api/curriculum/units', { method: 'POST', body: JSON.stringify(body) }),
  updateCurriculumUnit: (id: string, body: Omit<CurriculumUnit, 'id' | 'campusId' | 'gradeName' | 'subjectName'>) =>
    request<CurriculumUnit>(`/api/curriculum/units/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCurriculumUnit: (id: string) =>
    request<void>(`/api/curriculum/units/${id}`, { method: 'DELETE' }),
  lessonPlans: (filters: { from?: string; to?: string; sectionId?: string } = {}) => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]);
    return request<LessonPlan[]>(`/api/lesson-plans${params.size ? `?${params}` : ''}`);
  },
  createLessonPlan: (body: Omit<LessonPlan, 'id' | 'campusId' | 'academicYearId' | 'status' | 'sectionId' | 'sectionName' | 'subjectId' | 'subjectName' | 'teacherName' | 'unitName' | 'completedAt'>) =>
    request<LessonPlan>('/api/lesson-plans', { method: 'POST', body: JSON.stringify(body) }),
  updateLessonPlan: (id: string, body: Partial<Pick<LessonPlan, 'titleEn' | 'titleAm' | 'objectivesEn' | 'objectivesAm' | 'activitiesEn' | 'activitiesAm' | 'resources' | 'status'>>) =>
    request<LessonPlan>(`/api/lesson-plans/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  promotionRules: () => request<PromotionRule[]>('/api/promotion-rules'),
  savePromotionRule: (gradeId: string, body: Pick<PromotionRule, 'minimumAnnualPercent' | 'maximumFailedRequiredSubjects'>) =>
    request<PromotionRule>(`/api/grades/${gradeId}/promotion-rule`, { method: 'PUT', body: JSON.stringify(body) }),
  progressionEligibility: (studentId: string) =>
    request<ProgressionEligibility>(`/api/students/${studentId}/progression-eligibility`),
  grades: () => request<GradeLevel[]>('/api/grades'),
  curriculumGrades: () => request<GradeCatalogEntry[]>('/api/curriculum/grades'),
  createGrade: (body: Pick<GradeCatalogEntry, 'code'>) =>
    request<GradeLevel>('/api/grades', { method: 'POST', body: JSON.stringify(body) }),
  gradeSubjects: (gradeId: string, stream?: Section['stream']) => {
    const params = stream ? `?stream=${encodeURIComponent(stream)}` : '';
    return request<GradeSubject[]>(`/api/grades/${gradeId}/subjects${params}`);
  },
  replaceGradeSubjects: (gradeId: string, subjects: Pick<GradeSubject, 'subjectId' | 'stream' | 'weeklyPeriods' | 'isRequired'>[]) =>
    request<GradeSubject[]>(`/api/grades/${gradeId}/subjects`, {
      method: 'PUT', body: JSON.stringify({ subjects })
    }),
  createSection: (body: { gradeLevelId: string; name: string; capacity: number | null; shift?: 'morning' | 'afternoon' | 'evening'; stream?: 'natural_science' | 'social_science' }) =>
    request<Section>('/api/sections', { method: 'POST', body: JSON.stringify(body) }),
  updateSectionCapacity: (id: string, capacity: number | null) =>
    request<Section>(`/api/sections/${id}/capacity`, { method: 'PATCH', body: JSON.stringify({ capacity }) }),
  subjects: () => request<Subject[]>('/api/subjects'),
  createSubject: (body: Omit<Subject, 'id' | 'campusId'>) =>
    request<Subject>('/api/subjects', { method: 'POST', body: JSON.stringify(body) }),
  departments: () => request<Department[]>('/api/departments'),
  createDepartment: (body: Pick<Department, 'name' | 'description'>) =>
    request<Department>('/api/departments', { method: 'POST', body: JSON.stringify(body) }),
  staff: () => request<StaffMember[]>('/api/staff'),
  createStaff: (body: Omit<StaffMember, 'id' | 'campusId' | 'name' | 'departmentName' | 'teachingAssignmentCount' | 'homeroomCount'>) =>
    request<StaffMember>('/api/staff', { method: 'POST', body: JSON.stringify(body) }),
  teachingAssignments: () => request<TeachingAssignment[]>('/api/teaching-assignments'),
  createTeachingAssignment: (body: Pick<TeachingAssignment, 'staffId' | 'sectionId' | 'subjectId' | 'dayOfWeek' | 'periodNumber'> & { roomId?: string | null }) =>
    request<TeachingAssignment>('/api/teaching-assignments', { method: 'POST', body: JSON.stringify(body) }),
  timetablePeriods: () => request<TimetablePeriod[]>('/api/timetable/periods'),
  createTimetablePeriod: (body: Omit<TimetablePeriod, 'id' | 'campusId'>) =>
    request<TimetablePeriod>('/api/timetable/periods', { method: 'POST', body: JSON.stringify(body) }),
  rooms: () => request<Room[]>('/api/timetable/rooms'),
  createRoom: (body: Pick<Room, 'name' | 'capacity'>) =>
    request<Room>('/api/timetable/rooms', { method: 'POST', body: JSON.stringify(body) }),
  timetable: (query: { sectionId?: string; date?: string } = {}) => {
    const params = new URLSearchParams();
    if (query.sectionId) params.set('sectionId', query.sectionId);
    if (query.date) params.set('date', query.date);
    return request<TeachingAssignment[]>(`/api/timetable${params.size ? `?${params.toString()}` : ''}`);
  },
  examTypes: () => request<ExamType[]>('/api/exam-types'),
  createExamType: (body: Pick<ExamType, 'code' | 'name' | 'weightPercent'>) =>
    request<ExamType>('/api/exam-types', { method: 'POST', body: JSON.stringify(body) }),
  updateExamType: (id: string, body: Partial<Pick<ExamType, 'name' | 'weightPercent' | 'isActive'>>) =>
    request<ExamType>(`/api/exam-types/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  exams: (termId?: string) => {
    const query = termId ? `?termId=${encodeURIComponent(termId)}` : '';
    return request<ExamRecord[]>(`/api/exams${query}`);
  },
  assignments: () => request<AssignmentRecord[]>('/api/assignments'),
  createAssignment: (body: Pick<AssignmentRecord, 'academicYearId' | 'termId' | 'gradeLevelId' |
    'sectionId' | 'subjectId' | 'title' | 'instructions' | 'dueAt'>) =>
    request<AssignmentRecord>('/api/assignments', { method: 'POST', body: JSON.stringify(body) }),
  updateAssignment: (id: string, body: Partial<Pick<AssignmentRecord, 'academicYearId' | 'termId' |
    'gradeLevelId' | 'sectionId' | 'subjectId' | 'title' | 'instructions' | 'dueAt'>>) =>
    request<AssignmentRecord>(`/api/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  transitionAssignment: (id: string, status: 'published' | 'closed' | 'archived') =>
    request<AssignmentRecord>(`/api/assignments/${id}/status`, {
      method: 'POST', body: JSON.stringify({ status })
    }),
  assignmentSubmissions: (id: string) =>
    request<AssignmentSubmission[]>(`/api/assignments/${id}/submissions`),
  gradeAssignmentSubmission: (assignmentId: string, submissionId: string,
    body: { grade: number; feedback?: string | null }) =>
    request<AssignmentSubmission>(`/api/assignments/${assignmentId}/submissions/${submissionId}/grade`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  portalAssignments: () => request<AssignmentRecord[]>('/api/portal/assignments'),
  submitAssignment: (id: string, text: string) =>
    request<AssignmentSubmission>(`/api/portal/assignments/${id}/submission`, {
      method: 'PUT', body: JSON.stringify({ text })
    }),
  uploadAssignmentAttachment: async (id: string, file: File, portal = false) => {
    const path = portal
      ? `/api/portal/assignments/${id}/attachments`
      : `/api/assignments/${id}/attachments`;
    const response = await fetchWithRefresh(path, {
      method: 'POST', body: file,
      headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    }
    return (await response.json() as ApiEnvelope<AssignmentAttachment>).data;
  },
  downloadAssignmentAttachment: (id: string, portal = false) =>
    requestBlob(portal ? `/api/portal/assignment-attachments/${id}` :
      `/api/assignments/attachments/${id}`),
  examMonitoring: () => request<ExamMonitorRow[]>('/api/exams/monitoring'),
  createExam: (body: {
    title: string; termId: string; gradeLevelId: string; subjectId: string;
    examTypeId: string; maxValue: number;
    scheduleEntries?: {
      sectionId: string; examDate: string; startsAt: string; endsAt: string;
      roomId?: string; invigilatorIds: string[]
    }[]
  }) => request<ExamRecord>('/api/exams', { method: 'POST', body: JSON.stringify(body) }),
  addExamScheduleEntry: (examId: string, body: {
    sectionId: string; examDate: string; startsAt: string; endsAt: string;
    roomId?: string; invigilatorIds: string[]
  }) => request<ExamScheduleEntry>(`/api/exams/${examId}/schedule`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  updateExamScheduleEntry: (examId: string, entryId: string, body: {
    sectionId: string; examDate: string; startsAt: string; endsAt: string;
    roomId?: string; invigilatorIds: string[]
  }) => request<ExamScheduleEntry>(`/api/exams/${examId}/schedule/${entryId}`, {
    method: 'PUT', body: JSON.stringify(body)
  }),
  updateExam: (id: string, body: { title?: string; maxValue?: number }) =>
    request<ExamRecord>(`/api/exams/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  publishExamSchedule: (id: string) =>
    request<ExamRecord>(`/api/exams/${id}/schedule/publish`, { method: 'POST' }),
  openExamMarks: (id: string) =>
    request<ExamRecord>(`/api/exams/${id}/marks/open`, { method: 'POST' }),
  assignTimetableSubstitute: (assignmentId: string, body: {
    substituteStaffId: string; date: string; leaveRequestId: string; reason: string
  }) => request<{ id: string; assignmentId: string; substituteStaffId: string; substituteName: string; date: string }>(
    `/api/timetable/assignments/${assignmentId}/substitutions`, { method: 'POST', body: JSON.stringify(body) }
  ),
  assignHomeroom: (sectionId: string, staffId: string) =>
    request<{ sectionId: string; staffId: string; staffName: string; sectionName: string }>(
      `/api/sections/${sectionId}/homeroom`, { method: 'PUT', body: JSON.stringify({ staffId }) }
    ),
  staffAttendance: () => request<StaffAttendance[]>('/api/staff/attendance'),
  downloadStaffAttendanceCsv: async () => {
    const response = await fetchWithRefresh('/api/staff/attendance.csv', {});
    if (!response.ok) throw new Error(`Attendance export failed (${response.status}).`);
    return response.blob();
  },
  recordStaffAttendance: (body: { staffId?: string; date: string; status: string; clockIn?: string; clockOut?: string }) =>
    request<StaffAttendance>('/api/staff/attendance', { method: 'POST', body: JSON.stringify(body) }),
  leaveRequests: () => request<LeaveRequest[]>('/api/leave-requests'),
  createLeaveRequest: (body: { staffId?: string; startDate: string; endDate: string; reason: string }) =>
    request<LeaveRequest>('/api/leave-requests', { method: 'POST', body: JSON.stringify(body) }),
  reviewLeaveRequest: (id: string, decision: 'approved' | 'rejected', note = '') =>
    request<LeaveRequest>(`/api/leave-requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ decision, note })
    }),
  staffMessages: () => request<StaffMessage[]>('/api/staff/messages'),
  createStaffMessage: (body: { departmentId: string | null; type: 'handover' | 'announcement'; title: string; body: string }) =>
    request<StaffMessage>('/api/staff/messages', { method: 'POST', body: JSON.stringify(body) }),
  updateSchool: (body: Pick<SchoolProfile, 'name' | 'address' | 'phone'>) =>
    request<SchoolProfile>('/api/school', { method: 'PUT', body: JSON.stringify(body) }),
  students: () => request<Student[]>('/api/students'),
  alumni: () => request<Student[]>('/api/alumni'),
  student: (id: string) => request<Student>(`/api/students/${id}`),
  studentEnrollmentHistory: (id: string) => request<StudentEnrollment[]>(`/api/students/${id}/enrolments`),
  studentSectionTransfers: (id: string) =>
    request<{ id: string; fromSection: string; toSection: string; reason: string; createdAt: string }[]>(`/api/students/${id}/section-transfers`),
  transferStudentSection: (id: string, sectionId: string, reason: string) =>
    request<Student>(`/api/students/${id}/section-transfer`, {
      method: 'POST', body: JSON.stringify({ sectionId, reason })
    }),
  studentDocuments: (id: string) => request<StudentDocument[]>(`/api/students/${id}/documents`),
  uploadStudentDocument: (id: string, type: StudentDocument['documentType'], file: File) =>
    request<StudentDocument>(`/api/students/${id}/documents?type=${encodeURIComponent(type)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'Content-Type': file.type }, body: file
    }),
  downloadStudentDocument: (id: string, documentId: string) =>
    requestBlob(`/api/students/${id}/documents/${documentId}`),
  studentTransferPackages: (id: string) =>
    request<StudentTransferPackage[]>(`/api/students/${id}/transfer-packages`),
  createStudentTransferPackage: (id: string, body: {
    recipientSchool: string; guardianName: string; guardianRelationship: string;
    consentRecordedOn: string; consentDocumentId: string
  }) => request<StudentTransferPackage>(`/api/students/${id}/transfer-packages`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  approveStudentTransferPackage: (id: string, packageId: string) =>
    request<StudentTransferPackage & { shareUrl: string }>(
      `/api/students/${id}/transfer-packages/${packageId}/approve`, { method: 'POST' }
    ),
  studentTransferPacket: (token: string) =>
    request<StudentTransferPacket>(`/api/public/student-transfers/${encodeURIComponent(token)}`),
  studentDiscipline: (id: string) => request<StudentDisciplineRecord[]>(`/api/students/${id}/discipline`),
  createStudentDiscipline: (id: string, body: Omit<StudentDisciplineRecord, 'id' | 'studentId' | 'createdAt'>) =>
    request<StudentDisciplineRecord>(`/api/students/${id}/discipline`, { method: 'POST', body: JSON.stringify(body) }),
  sections: () => request<Section[]>('/api/sections'),
  createStudent: (body: Omit<Student, 'id' | 'campusId' | 'status'>) =>
    request<StudentCreationResult>('/api/students', { method: 'POST', body: JSON.stringify(body) }),
  previewStudentImport: (csv: string) => request<StudentImportPreview>('/api/students/import/preview', {
    method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv
  }),
  commitStudentImport: (csv: string) => request<StudentImportResult>('/api/students/import/commit', {
    method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csv
  }),
  updateStudentProfile: (id: string, body: StudentProfileUpdate) =>
    request<Student>(`/api/students/${id}/profile`, { method: 'PATCH', body: JSON.stringify(body) }),
  studentSensitiveData: (id: string) =>
    request<StudentSensitiveData>(`/api/students/${id}/sensitive-data`),
  updateStudentSensitiveData: (id: string, body: StudentSensitiveData) =>
    request<StudentSensitiveData>(`/api/students/${id}/sensitive-data`, {
      method: 'PUT', body: JSON.stringify(body)
    }),
  studentEmergencyContacts: (id: string) =>
    request<StudentEmergencyContact[]>(`/api/students/${id}/emergency-contacts`),
  addStudentEmergencyContact: (id: string, body: Pick<StudentEmergencyContact, 'name' | 'phone' | 'relationship' | 'priority'>) =>
    request<StudentEmergencyContact>(`/api/students/${id}/emergency-contacts`, {
      method: 'POST', body: JSON.stringify(body)
    }),
  removeStudentEmergencyContact: (studentId: string, contactId: string) =>
    request<void>(`/api/students/${studentId}/emergency-contacts/${contactId}`, { method: 'DELETE' }),
  studentCommendations: (id: string) =>
    request<StudentCommendation[]>(`/api/students/${id}/commendations`),
  createStudentCommendation: (id: string, body: Omit<StudentCommendation, 'id' | 'campusId' | 'studentId' | 'createdBy' | 'createdAt'>) =>
    request<StudentCommendation>(`/api/students/${id}/commendations`, { method: 'POST', body: JSON.stringify(body) }),
  studentGuardians: (id: string) => request<StudentGuardian[]>(`/api/students/${id}/guardians`),
  addStudentGuardian: (id: string, body: Omit<StudentGuardian, 'id' | 'isVerified' | 'canViewResults' | 'canViewFees' | 'hasPortalAccount'>) =>
    request<StudentGuardian>(`/api/students/${id}/guardians`, { method: 'POST', body: JSON.stringify(body) }),
  removeStudentGuardian: (studentId: string, guardianId: string) =>
    request<void>(`/api/students/${studentId}/guardians/${guardianId}`, { method: 'DELETE' }),
  admissions: (query = '', status: Admission['status'] | '' = '') => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (status) params.set('status', status);
    return request<Admission[]>(`/api/admissions${params.size ? `?${params.toString()}` : ''}`);
  },
  admissionDashboard: () => request<AdmissionDashboard>('/api/admissions/dashboard'),
  admissionsPublicLink: () => request<{ token: string }>('/api/admissions/public-link'),
  publicAdmissionInfo: (token: string) =>
    request<PublicAdmissionInfo>(`/api/public/admissions/${encodeURIComponent(token)}`),
  submitPublicAdmission: (token: string, body: Record<string, unknown>) =>
    request<{ reference: string; message: string }>(`/api/public/admissions/${encodeURIComponent(token)}`, {
      method: 'POST', body: JSON.stringify(body)
    }),
  admissionDuplicates: (params: { name?: string; dateOfBirth?: string; guardianPhone?: string }) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => { if (value) query.set(key, value); });
    return request<{ id: string; type: 'admission' | 'student'; status: string; name: string; guardianPhone: string }[]>(
      `/api/admissions/duplicates?${query.toString()}`
    );
  },
  createAdmission: (body: Record<string, unknown>) =>
    request<Admission>('/api/admissions', { method: 'POST', body: JSON.stringify(body) }),
  updateAdmissionStatus: (id: string, body: { status: string; decisionNote?: string }) =>
    request<Admission>(`/api/admissions/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  scheduleAdmissionInterview: (id: string, body: { interviewAt: string; interviewResult: string }) =>
    request<Admission>(`/api/admissions/${id}/interview`, { method: 'POST', body: JSON.stringify(body) }),
  enrolAdmission: (id: string, body: { sectionId: string; siblingStudentId?: string | null }) =>
    request<{ student: Student; admission: Admission; credentials: StudentCredentials }>(`/api/admissions/${id}/enrol`, { method: 'POST', body: JSON.stringify(body) }),
  uploadAdmissionDocument: (id: string, type: string, file: File) =>
    request<AdmissionDocument>(`/api/admissions/${id}/documents?type=${encodeURIComponent(type)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'Content-Type': file.type }, body: file
    }),
  downloadAdmissionDocument: (id: string, documentId: string) =>
    requestBlob(`/api/admissions/${id}/documents/${documentId}`),
  offerLetter: (id: string) => requestText(`/api/admissions/${id}/offer-letter`),
  withdrawStudent: (id: string, reason: string) =>
    request<Student>(`/api/students/${id}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) }),
  readmitStudent: (id: string, sectionId: string, reason: string) =>
    request<Student>(`/api/students/${id}/readmit`, { method: 'POST', body: JSON.stringify({ sectionId, reason }) }),
  transferStudentOut: (id: string, reason: string) =>
    request<Student>(`/api/students/${id}/transfer-out`, { method: 'POST', body: JSON.stringify({ reason }) }),
  advanceStudent: (id: string, body: { outcome: 'promoted' | 'repeated' | 'graduated'; sectionId?: string; reason: string; overrideReason?: string }) =>
    request<Student>(`/api/students/${id}/progression`, { method: 'POST', body: JSON.stringify(body) }),
  transferCertificate: (id: string) => requestText(`/api/students/${id}/transfer-certificate`),
  attendance: () => request<AttendanceSession[]>('/api/attendance'),
  attendanceRoster: (sectionId: string) =>
    request<Student[]>(`/api/attendance/sections/${sectionId}/roster`),
  attendanceSession: (id: string) => request<AttendanceSession>(`/api/attendance/sessions/${id}`),
  correctAttendance: (sessionId: string, studentId: string, body: { status: string; reason: string }) =>
    request<AttendanceCorrectionResult>(`/api/attendance/sessions/${sessionId}/records/${studentId}`, {
      method: 'PATCH', body: JSON.stringify(body)
    }),
  attendanceCorrectionRequests: () =>
    request<AttendanceCorrectionRequest[]>('/api/attendance/correction-requests'),
  reviewAttendanceCorrection: (id: string, decision: 'approved' | 'rejected', note: string) =>
    request<AttendanceCorrectionRequest>(`/api/attendance/correction-requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ decision, note })
    }),
  attendanceSummary: (from: string, to: string) =>
    request<AttendanceSummary>(`/api/attendance/summary?${new URLSearchParams({ from, to })}`),
  submitAttendance: (body: Record<string, unknown>) =>
    request<AttendanceSession>('/api/attendance', { method: 'POST', body: JSON.stringify(body) }),
  marks: () => request<Mark[]>('/api/marks'),
  marksContext: () => request<{ terms: Term[]; subjects: Subject[] }>('/api/marks/context'),
  termMarksSummary: (termId: string) =>
    request<TermMarksSummary>(`/api/marks/summary?termId=${encodeURIComponent(termId)}`),
  submitMark: (body: Record<string, unknown>) =>
    request<Mark>('/api/marks', { method: 'POST', body: JSON.stringify(body) }),
  transitionMark: (id: string, action: 'submit' | 'approve' | 'publish') =>
    request<Mark>(`/api/marks/${id}/${action}`, { method: 'POST' }),
  amendMark: (id: string, body: { value: number; maxValue: number; reason: string }) =>
    request<Mark>(`/api/marks/${id}/amend`, { method: 'POST', body: JSON.stringify(body) }),
  gradingBands: () => request<GradingBand[]>('/api/grading/bands'),
  replaceGradingBands: (bands: Omit<GradingBand, 'id' | 'campusId'>[]) =>
    request<GradingBand[]>('/api/grading/bands', { method: 'PUT', body: JSON.stringify({ bands }) }),
  gradingPolicy: () => request<GradingPolicy>('/api/grading/policy'),
  confirmGradingPolicy: (scoringMethod: GradingPolicy['scoringMethod']) =>
    request<GradingPolicy>('/api/grading/policy', {
      method: 'PUT', body: JSON.stringify({ scoringMethod })
    }),
  reportCard: (studentId: string, termId: string) =>
    request<ReportCard>(`/api/report-cards/students/${studentId}?termId=${encodeURIComponent(termId)}`),
  createTermReportDraft: (studentId: string, termId: string, amendmentReason?: string) =>
    request<TermReportWorkflow>(`/api/report-cards/students/${studentId}/drafts`, {
      method: 'POST', body: JSON.stringify({ termId, amendmentReason })
    }),
  transitionTermReport: (id: string, action: 'submit' | 'approve' | 'publish') =>
    request<TermReportWorkflow>(`/api/report-cards/${id}/${action}`, { method: 'POST' }),
  feeItems: () => request<FeeItem[]>('/api/fees/items'),
  createFeeItem: (body: Omit<FeeItem, 'id' | 'campusId' | 'isActive'>) =>
    request<FeeItem>('/api/fees/items', { method: 'POST', body: JSON.stringify(body) }),
  updateFeeItem: (id: string, body: Omit<FeeItem, 'id' | 'campusId'>) =>
    request<FeeItem>(`/api/fees/items/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  feeInvoices: () => request<FeeInvoice[]>('/api/fees/invoices'),
  createFeeInvoice: (body: { studentId: string; dueDate: string | null; lines: { feeItemId: string; quantity: number }[] }) =>
    request<FeeInvoice>('/api/fees/invoices', { method: 'POST', body: JSON.stringify(body) }),
  voidFeeInvoice: (invoiceId: string, reason: string) =>
    request<FeeInvoice>(`/api/fees/invoices/${invoiceId}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  collectFeePayment: (invoiceId: string, body: {
    amount: number; method: FeePayment['method']; reference: string; idempotencyKey: string
  }) =>
    request<FeePayment>(`/api/fees/invoices/${invoiceId}/payments`, { method: 'POST', body: JSON.stringify(body) }),
  reverseFeePayment: (paymentId: string, body: { amount: number; reason: string }) =>
    request<FeePayment>(`/api/fees/payments/${paymentId}/reversals`, { method: 'POST', body: JSON.stringify(body) }),
  feeReceipt: (receiptNumber: string) =>
    request<FeeReceipt>(`/api/fees/receipts/${encodeURIComponent(receiptNumber)}`),
  currentCashierShift: () => request<CashierShift | null>('/api/fees/shifts/current'),
  cashierShifts: () => request<CashierShift[]>('/api/fees/shifts'),
  openCashierShift: (body: { openingFloat: number; currencyCode: string }) =>
    request<CashierShift>('/api/fees/shifts', { method: 'POST', body: JSON.stringify(body) }),
  closeCashierShift: (id: string, closingCash: number) =>
    request<CashierShift>(`/api/fees/shifts/${id}/close`, { method: 'POST', body: JSON.stringify({ closingCash }) }),
  feeExpenses: (from: string, to: string) =>
    request<FeeExpense[]>(`/api/fees/expenses?${new URLSearchParams({ from, to })}`),
  createFeeExpense: (body: {
    category: string; description: string; amount: number; currencyCode: string;
    method: FeePayment['method']; reference: string
  }) => request<FeeExpense>('/api/fees/expenses', { method: 'POST', body: JSON.stringify(body) }),
  feeSummary: (from: string, to: string) =>
    request<FeeSummary>(`/api/fees/summary?${new URLSearchParams({ from, to })}`),
  feeStructures: () => request<FeeStructure[]>('/api/fees/structures'),
  createFeeStructure: (body: {
    academicYearId: string; gradeLevelId: string; name: string; currencyCode: string;
    installments: { dueDate: string; amountMinor: number }[]
  }) => request<FeeStructure>('/api/fees/structures', { method: 'POST', body: JSON.stringify(body) }),
  previewFeeStructure: (id: string, sectionId?: string) => {
    const params = sectionId ? `?sectionId=${encodeURIComponent(sectionId)}` : '';
    return request<unknown>(`/api/fees/structures/${id}/preview${params}`);
  },
  generateFeeStructureInvoices: (id: string, body: { sectionId?: string; idempotencyKey: string }) =>
    request<{ generationId: string; invoiceCount: number; duplicate: boolean }>(
      `/api/fees/structures/${id}/generate`, { method: 'POST', body: JSON.stringify(body) }),
  feeDiscountRequests: () => request<FeeDiscountRequest[]>('/api/fees/discount-requests'),
  feeDiscountTypes: () => request<FeeDiscountType[]>('/api/fees/discount-types'),
  createFeeDiscountType: (body: {
    code: string; name: string; category: FeeDiscountType['category'];
    discountKind: FeeDiscountType['discountKind']
  }) => request<FeeDiscountType>('/api/fees/discount-types', {
    method: 'POST', body: JSON.stringify(body)
  }),
  requestFeeDiscount: (body: {
    studentId: string; discountTypeId: string; periodKey: string;
    percentageBasisPoints?: number; fixedAmountMinor?: number; reason: string; idempotencyKey: string
  }) => request<FeeDiscountRequest>('/api/fees/discount-requests', {
    method: 'POST', body: JSON.stringify(body)
  }),
  transitionFeeDiscount: (id: string, status: 'approved' | 'rejected' | 'cancelled') =>
    request<FeeDiscountRequest>(`/api/fees/discount-requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  feeRefundRequests: () => request<FeeRefundRequest[]>('/api/fees/refund-requests'),
  requestFeeRefund: (body: {
    paymentId: string; amountMinor: number; reason: string; idempotencyKey: string
  }) => request<FeeRefundRequest>('/api/fees/refund-requests', {
    method: 'POST', body: JSON.stringify(body)
  }),
  transitionFeeRefund: (id: string, status: 'approved' | 'rejected') =>
    request<FeeRefundRequest>(`/api/fees/refund-requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  feeAdjustmentRequests: () => request<FeeAdjustmentRequest[]>('/api/fees/adjustment-requests'),
  requestFeeAdjustment: (body: {
    invoiceId: string; adjustmentType: 'credit' | 'debit'; amountMinor: number;
    reason: string; idempotencyKey: string
  }) => request<FeeAdjustmentRequest>('/api/fees/adjustment-requests', {
    method: 'POST', body: JSON.stringify(body)
  }),
  transitionFeeAdjustment: (id: string, status: 'approved' | 'rejected') =>
    request<FeeAdjustmentRequest>(`/api/fees/adjustment-requests/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status })
    }),
  feeArrears: (asOf?: string) => request<FeeArrearsRow[]>(
    `/api/fees/arrears${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`),
  createFeeArrearsFollowup: (invoiceId: string, body: { note: string; nextContactOn?: string }) =>
    request<{ id: string; invoiceId: string; note: string; nextContactOn: string | null }>(
      `/api/fees/invoices/${invoiceId}/followups`, {
        method: 'POST', body: JSON.stringify(body)
      }),
  feeStudentStatement: (studentId: string) =>
    request<{ studentId: string; studentNo: string; invoices: FeeInvoice[] }>(
      `/api/fees/students/${studentId}/statement`),
  portalFeeInvoices: () => request<FeeInvoice[]>('/api/fees/portal/invoices'),
  portalFeeStatement: (studentId: string) =>
    request<{ studentId: string; studentNo: string; invoices: FeeInvoice[] }>(
      `/api/fees/portal/students/${studentId}/statement`),
  financeDashboard: () => request<FinanceDashboard>('/api/fees/dashboard'),
  cashbookAccounts: () => request<CashbookAccount[]>('/api/fees/cashbook/accounts'),
  createCashbookAccount: (body: {
    name: string; accountType: 'cash' | 'bank'; currencyCode: string;
    openingBalanceMinor: number; idempotencyKey: string
  }) => request<CashbookAccount>('/api/fees/cashbook/accounts', {
    method: 'POST', body: JSON.stringify(body)
  }),
  cashbookEntries: (accountId: string, from: string, to: string) =>
    request<CashbookEntry[]>(`/api/fees/cashbook/entries?${new URLSearchParams({ accountId, from, to })}`),
  depositCashbook: (accountId: string, body: {
    amountMinor: number; description: string; reference?: string; idempotencyKey: string
  }) => request<CashbookEntry>(`/api/fees/cashbook/accounts/${accountId}/deposits`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  transferCashbook: (body: {
    fromAccountId: string; toAccountId: string; amountMinor: number;
    description: string; idempotencyKey: string
  }) => request<unknown>('/api/fees/cashbook/transfers', { method: 'POST', body: JSON.stringify(body) }),
  reconcileCashbook: (accountId: string, body: {
    statementDate: string; statementBalanceMinor: number
  }) => request<{ differenceMinor: number }>(`/api/fees/cashbook/accounts/${accountId}/reconciliations`, {
    method: 'POST', body: JSON.stringify(body)
  }),
  downloadFeeArrearsCsv: async (asOf?: string) =>
    requestBlob(`/api/fees/arrears.csv${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ''}`),
  financeReport: (type: string, from: string, to: string) =>
    request<FinanceReport>(`/api/fees/reports?${new URLSearchParams({ type, from, to })}`),
  downloadFinanceReportCsv: async (type: string, from: string, to: string) =>
    requestBlob(`/api/fees/reports?${new URLSearchParams({ type, from, to, format: 'csv' })}`),
  campusAnnouncements: () => request<CampusAnnouncement[]>('/api/communications/announcements'),
  createCampusAnnouncement: (body: Pick<CampusAnnouncement, 'titleEn' | 'titleAm' | 'bodyEn' | 'bodyAm'>) =>
    request<CampusAnnouncement>('/api/communications/announcements', { method: 'POST', body: JSON.stringify(body) }),
  campusEvents: (from: string, to: string) =>
    request<CampusEvent[]>(`/api/communications/events?${new URLSearchParams({ from, to })}`),
  createCampusEvent: (body: Omit<CampusEvent, 'id' | 'campusId' | 'createdBy'>) =>
    request<CampusEvent>('/api/communications/events', { method: 'POST', body: JSON.stringify(body) }),
  notifications: () => request<NotificationInbox>('/api/notifications'),
  markNotificationRead: (id: string) =>
    request<UserNotification>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' })
};

export async function queueOfflineOperation(path: string, body: Record<string, unknown>, ownerId: string) {
  const db = await offlineDb();
  await db.put('operations', {
    id: `${ownerId}:${String(body.clientUuid)}`, ownerId, path, body, createdAt: Date.now()
  } satisfies PendingOperation);
  const rows = await db.getAll('operations') as PendingOperation[];
  return rows.filter((row) => row.ownerId === ownerId).length;
}

export async function pendingOfflineCount(ownerId?: string) {
  const db = await offlineDb();
  if (!ownerId) return 0;
  const rows = await db.getAll('operations') as PendingOperation[];
  return rows.filter((row) => row.ownerId === ownerId).length;
}

export async function syncOfflineOperations(ownerId: string) {
  if (!navigator.onLine) return 0;
  const db = await offlineDb();
  const operations = (await db.getAll('operations') as PendingOperation[])
    .filter((operation) => operation.ownerId === ownerId);
  let synced = 0;
  for (const operation of operations) {
    try {
      await request(operation.path, { method: 'POST', body: JSON.stringify(operation.body) });
      await db.delete('operations', operation.id);
      synced += 1;
    } catch {
      break;
    }
  }
  return synced;
}

export function hasAccessToken() { return Boolean(accessToken); }
