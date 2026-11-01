import { openDB } from 'idb';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
let accessToken: string | null = null;

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
  activeCampusId: string; mustChangePassword?: boolean
};
export type SchoolAccount = {
  id: string; name: string; email: string | null; role: string;
  isActive: boolean; campusIds: string[]
};
export type SubscriptionPlan = {
  id: string; code: string; name: string; description: string; monthlyPrice: number;
  currencyCode: string; trialDays: number; studentLimit: number | null;
  staffLimit: number | null; siteLimit: number | null; modules: string[]; isActive: boolean
};
export type SchoolSubscription = {
  id: string; status: string; trialStartedAt: string | null; trialEndsAt: string | null;
  periodStartedAt: string | null; periodEndsAt: string | null; plan: SubscriptionPlan;
  invoices: { id: string; invoiceNumber: string; amount: number; currencyCode: string;
    status: string; dueOn: string | null; issuedAt: string | null; paidAt: string | null;
    payments?: { id: string; amount: number; reference: string | null; receivedOn: string }[] }[]
};
export type OrganizationSettings = {
  id: string; name: string; status: string; preferredLocale: 'en' | 'am';
  currencyCode: string; branding: { logoUrl: string; primaryColor: string }
};
export type OrganizationBranch = {
  id: string; organizationId: string; name: string; address: string;
  phone: string; timezone: string; isActive: boolean
};
export type PlatformSchool = OrganizationSettings & {
  owner: { name: string; email: string } | null;
  campuses: { id: string; name: string }[]; studentCount: number;
  subscription: { status: string; trialEndsAt: string | null; planCode: string; planName: string } | null
};
export type OrganizationClosure = {
  id: string; organizationId: string; schoolName: string; status: string;
  reason: string; requesterName: string; requestedAt: string; exportedAt: string | null;
  retentionUntil: string | null; financialRetentionUntil: string | null; completedAt?: string | null
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
export type Mark = {
  id: string; studentId: string; assessmentName: string; maxValue: number;
  value: number; state: 'draft' | 'submitted' | 'approved' | 'locked';
  termId?: string | null; subjectId?: string | null; enteredBy?: string;
  approvedBy?: string | null; publishedBy?: string | null
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
    band: Pick<GradingBand, 'code' | 'nameEn' | 'nameAm'> | null
  }[];
  totalValue: number; totalMaxValue: number; overallPercent: number;
  overallBand: Pick<GradingBand, 'code' | 'nameEn' | 'nameAm'> | null;
  status: 'provisional'; scoringMethod: GradingPolicy['scoringMethod'];
  gradingPolicyConfirmed: boolean; gradingPolicyConfirmedAt: string | null;
  sourceMarkFingerprint: string
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
  recordedAt: string; currencyCode?: string
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
export type CampusAnnouncement = {
  id: string; campusId: string; titleEn: string; titleAm: string;
  bodyEn: string; bodyAm: string; createdBy: string; publishedAt: string
};
export type CampusEvent = {
  id: string; campusId: string; titleEn: string; titleAm: string;
  descriptionEn: string; descriptionAm: string; startsOn: string; endsOn: string;
  startsAt: string | null; endsAt: string | null; location: string; createdBy: string
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
}

async function request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && allowRefresh && path !== '/api/auth/login' && path !== '/api/auth/refresh') {
    const refresh = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) {
      const payload = await refresh.json() as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(payload.data.accessToken);
      headers.set('Authorization', `Bearer ${payload.data.accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
    } else setAccessToken(null);
  }
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
  const headers = new Headers();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  if (response.status === 401) {
    const refresh = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) {
      const payload = await refresh.json() as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(payload.data.accessToken);
      headers.set('Authorization', `Bearer ${payload.data.accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
    } else setAccessToken(null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.text();
}

async function requestBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  if (response.status === 401) {
    const refresh = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (refresh.ok) {
      const payload = await refresh.json() as ApiEnvelope<{ accessToken: string }>;
      setAccessToken(payload.data.accessToken);
      headers.set('Authorization', `Bearer ${payload.data.accessToken}`);
      response = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
    } else setAccessToken(null);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Request failed (${response.status})`);
  }
  return response.blob();
}

export const api = {
  registerSchool: (body: {
    schoolName: string; ownerName: string; ownerEmail: string; ownerPhone: string;
    schoolPhone: string; address: string; password: string; confirmPassword: string; locale: 'en' | 'am';
    currencyCode: string; timezone: string
  }) => request<{ organizationId: string; status: string; message: string }>(
    '/api/school-registration', { method: 'POST', body: JSON.stringify(body) }, false
  ),
  platformDashboard: () => request<{
    organizationId: string;
    totals: { schools: number; pending: number; active: number; suspended: number; students: number };
    schools: PlatformSchool[]; plans: SubscriptionPlan[]
  }>('/api/platform'),
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
  me: () => request<User>('/api/auth/me'),
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
  logout: async () => {
    await request<void>('/api/auth/logout', { method: 'POST' }, false).catch(() => undefined);
    setAccessToken(null);
  },
  dashboard: () => request<Dashboard>('/api/dashboard'),
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
    const headers = new Headers();
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    let response = await fetch(`${API_BASE}/api/staff/attendance.csv`, { headers, credentials: 'include' });
    if (response.status === 401) {
      const refresh = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (refresh.ok) {
        const payload = await refresh.json() as ApiEnvelope<{ accessToken: string }>;
        setAccessToken(payload.data.accessToken);
        headers.set('Authorization', `Bearer ${payload.data.accessToken}`);
        response = await fetch(`${API_BASE}/api/staff/attendance.csv`, { headers, credentials: 'include' });
      }
    }
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
  collectFeePayment: (invoiceId: string, body: { amount: number; method: FeePayment['method']; reference: string }) =>
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
