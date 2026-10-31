import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from './logger.js';
import { SCHOOL_GRADE_CATALOG } from './school-curriculum.js';
import { verifyAccessToken } from './auth.js';
import {
  registerAuthenticatedAuthRoutes, registerPublicAuthRoutes
} from './routes/auth.js';
import {
  registerAccountInvitationRoute, registerAccountRoutes
} from './routes/accounts.js';
import {
  registerPlatformLicenceRoutes, registerPlatformRoutes
} from './routes/platform.js';

function addisDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Addis_Ababa', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const schoolRegistrationSchema = z.object({
  schoolName: z.string().trim().min(2).max(180),
  ownerName: z.string().trim().min(2).max(180),
  ownerEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  ownerPhone: z.string().trim().min(7).max(32),
  schoolPhone: z.string().trim().min(7).max(32),
  address: z.string().trim().min(2).max(500),
  password: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128),
  locale: z.enum(['en', 'am']).default('en'),
  currencyCode: z.enum(['ETB', 'USD']).default('ETB'),
  timezone: z.string().trim().min(3).max(64).default('Africa/Addis_Ababa')
}).refine((registration) => registration.password === registration.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword']
});
const organizationSettingsSchema = z.object({
  preferredLocale: z.enum(['en', 'am']),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  branding: z.object({
    logoUrl: z.union([z.literal(''), z.string().url().max(1000)]),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/)
  })
});
const closureRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1000)
});
const guardianAccessSchema = z.object({
  isVerified: z.boolean(),
  canViewResults: z.boolean(),
  canViewFees: z.boolean()
}).refine((access) => access.isVerified || (!access.canViewResults && !access.canViewFees), {
  message: 'Unverified guardians cannot receive portal permissions.'
});
const studentSchema = z.object({
  studentNo: z.string().trim().min(1).max(32),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  gender: z.enum(['female', 'male', 'other']),
  dateOfBirth: z.string().date().nullable().optional(),
  guardianPhone: z.string().trim().min(7).max(32).nullable().optional(),
  previousSchool: z.string().trim().max(180).nullable().optional(),
  sectionName: z.string().trim().min(1).max(80)
});
const studentProfileSchema = z.object({
  givenNameAm: z.string().trim().min(1).max(100).optional(),
  fatherNameAm: z.string().trim().min(1).max(100).optional(),
  grandfatherNameAm: z.string().trim().min(1).max(100).optional(),
  givenNameEn: z.string().trim().min(1).max(100).optional(),
  fatherNameEn: z.string().trim().min(1).max(100).optional(),
  grandfatherNameEn: z.string().trim().min(1).max(100).optional(),
  gender: z.enum(['female', 'male', 'other']).optional(),
  dateOfBirth: z.string().date().nullable().optional(),
  guardianPhone: z.string().trim().min(7).max(32).nullable().optional(),
  previousSchool: z.string().trim().max(180).nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one student profile field to update.'
});
const studentSensitiveDataSchema = z.object({
  idNumber: z.string().trim().max(128).nullable().optional(),
  healthNotes: z.string().trim().max(10000).nullable().optional(),
  specialNeeds: z.string().trim().max(10000).nullable().optional(),
  allergies: z.string().trim().max(10000).nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one protected student field to update.'
});
const studentGuardianSchema = z.object({
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(32),
  email: z.string().trim().email().max(254).nullable().optional(),
  relationship: z.string().trim().min(2).max(40),
  isPrimary: z.boolean().optional().default(false)
});
const studentEmergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(32),
  relationship: z.string().trim().min(2).max(60),
  priority: z.number().int().min(1).max(10).default(1)
});
const admissionSchema = z.object({
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  gender: z.enum(['female', 'male', 'other']),
  dateOfBirth: z.string().date().nullable().optional(),
  guardianName: z.string().trim().min(2).max(180),
  guardianPhone: z.string().trim().min(7).max(32),
  guardianEmail: z.string().trim().email().max(254).nullable().optional(),
  gradeLevelId: z.string().uuid(),
  previousSchool: z.string().trim().max(180).nullable().optional()
});
const publicAdmissionSchema = admissionSchema.extend({
  privacyConsent: z.literal(true)
});
const studentDocumentTypeSchema = z.enum([
  'photo', 'birth_certificate', 'previous_school_record', 'transfer_consent', 'other'
]);
const disciplineRecordSchema = z.object({
  recordedOn: z.string().date(),
  category: z.string().trim().min(2).max(80),
  details: z.string().trim().min(3).max(5000),
  actionTaken: z.string().trim().max(5000).nullable().optional()
});
const studentTransferPackageSchema = z.object({
  recipientSchool: z.string().trim().min(2).max(180),
  guardianName: z.string().trim().min(2).max(180),
  guardianRelationship: z.string().trim().min(2).max(60),
  consentRecordedOn: z.string().date(),
  consentDocumentId: z.string().uuid()
});
const admissionStatusSchema = z.object({
  status: z.enum(['application', 'accepted', 'waitlisted', 'rejected']),
  decisionNote: z.string().trim().max(2000).optional().default('')
});
const interviewSchema = z.object({
  interviewAt: z.string().datetime(),
  interviewResult: z.enum(['pending', 'passed', 'failed']).default('pending')
});
const admissionEnrolmentSchema = z.object({
  sectionId: z.string().uuid(),
  siblingStudentId: z.string().uuid().nullable().optional()
});
const studentStatusSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const studentProgressionSchema = z.object({
  outcome: z.enum(['promoted', 'repeated', 'graduated']),
  sectionId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500),
  overrideReason: z.string().trim().min(5).max(500).optional()
}).superRefine((data, context) => {
  if (data.outcome === 'graduated' && data.sectionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Graduated students cannot be assigned to a section.', path: ['sectionId'] });
  }
  if (data.outcome !== 'graduated' && !data.sectionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a section in the newly active academic year.', path: ['sectionId'] });
  }
});
const studentIdPatternSchema = z.object({
  pattern: z.string().trim().min(1).max(80).refine((value) => {
    const literal = value.replace(/\{(?:CAMPUS|YEAR|SEQ)\}/g, '');
    return value.includes('{SEQ}') && !/[{}]/.test(literal) && /^[A-Za-z0-9._ -]*$/.test(literal);
  }, {
    message: 'Use {CAMPUS}, {YEAR}, and {SEQ} tokens, including {SEQ}.'
  })
});
const attendanceSchema = z.object({
  clientUuid: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sectionId: z.string().uuid(),
  records: z.array(z.object({
    studentId: z.string().uuid(),
    status: z.enum(['present', 'absent', 'late', 'excused'])
  })).min(1).max(100)
}).superRefine((data, context) => {
  const ids = data.records.map((record) => record.studentId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Each student may appear only once.', path: ['records'] });
  }
});
const attendanceCorrectionSchema = z.object({
  status: z.enum(['present', 'absent', 'late', 'excused']),
  reason: z.string().trim().min(3).max(500)
});
const attendanceCorrectionReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().min(3).max(500)
});
const markSchema = z.object({
  clientUuid: z.string().uuid(),
  studentId: z.string().uuid(),
  assessmentName: z.string().trim().min(1).max(100),
  termId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  maxValue: z.number().positive().max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Maximum mark supports at most two decimal places.'
  }),
  value: z.number().min(0).max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Mark supports at most two decimal places.'
  })
}).refine((row) => row.value <= row.maxValue, {
  message: 'Mark cannot exceed its maximum value.',
  path: ['value']
}).refine((row) => Boolean(row.termId) === Boolean(row.subjectId), {
  message: 'Select both a term and subject for report-card marks.',
  path: ['subjectId']
});
const markAmendmentSchema = z.object({
  value: z.number().min(0).max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Mark supports at most two decimal places.'
  }),
  maxValue: z.number().positive().max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Maximum mark supports at most two decimal places.'
  }),
  reason: z.string().trim().min(5).max(500)
}).refine((row) => row.value <= row.maxValue, {
  message: 'Mark cannot exceed its maximum value.',
  path: ['value']
});
const gradingScaleSchema = z.object({
  bands: z.array(z.object({
    code: z.string().trim().min(1).max(24),
    nameEn: z.string().trim().min(1).max(80),
    nameAm: z.string().trim().min(1).max(80),
    minPercent: z.number().min(0).max(100).refine((value) => Number.isInteger(value * 100), {
      message: 'Grade thresholds support at most two decimal places.'
    })
  })).min(1).max(12)
}).superRefine(({ bands }, context) => {
  const codes = bands.map((band) => band.code.toLowerCase());
  const thresholds = bands.map((band) => band.minPercent);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Grading band codes must be unique.', path: ['bands'] });
  }
  if (new Set(thresholds).size !== thresholds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Grading thresholds must be unique.', path: ['bands'] });
  }
  if (!thresholds.includes(0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A grading scale must include a 0% threshold.', path: ['bands'] });
  }
});
const gradingPolicySchema = z.object({
  scoringMethod: z.enum(['points_weighted', 'equal_subject_weighted'])
});
const schoolProfileSchema = z.object({
  name: z.string().trim().min(2).max(180),
  address: z.string().trim().max(500).optional().default(''),
  phone: z.string().trim().max(32).optional().default('')
});
const academicYearSchema = z.object({
  labelEc: z.string().trim().min(4).max(24),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((year) => year.startDate < year.endDate, {
  message: 'Academic year end must be after its start.',
  path: ['endDate']
});
const academicYearIdSchema = z.string().uuid();
const termSchema = z.object({
  name: z.string().trim().min(1).max(80),
  periodType: z.enum(['term', 'semester']).default('term'),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((term) => term.startDate < term.endDate, {
  message: 'Term end must be after its start.',
  path: ['endDate']
});
const gradeSchema = z.object({
  code: z.string().trim().min(1).max(24)
});
const sectionSchema = z.object({
  gradeLevelId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  capacity: z.number().int().positive().max(1000).nullable().optional(),
  shift: z.enum(['morning', 'afternoon', 'evening']).default('morning'),
  stream: z.enum(['natural_science', 'social_science']).optional()
});
const sectionCapacitySchema = z.object({
  capacity: z.number().int().positive().max(1000).nullable()
});
const gradeSubjectsSchema = z.object({
  subjects: z.array(z.object({
    subjectId: z.string().uuid(),
    stream: z.enum(['all', 'natural_science', 'social_science']).default('all'),
    weeklyPeriods: z.number().int().min(1).max(60),
    isRequired: z.boolean().default(true)
  })).max(100)
});
const timetablePeriodSchema = z.object({
  shift: z.enum(['morning', 'afternoon', 'evening']),
  periodNumber: z.number().int().min(1).max(20),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/)
}).refine((period) => period.startsAt < period.endsAt, {
  message: 'Period end time must be after its start time.',
  path: ['endsAt']
});
const roomSchema = z.object({
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().positive().max(1000).nullable().optional()
});
const timetableQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  date: z.string().date().optional()
});
const substituteSchema = z.object({
  substituteStaffId: z.string().uuid(),
  date: z.string().date(),
  leaveRequestId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
});
const subjectSchema = z.object({
  code: z.string().trim().min(1).max(24),
  nameEn: z.string().trim().min(1).max(100),
  nameAm: z.string().trim().min(1).max(100),
  category: z.enum(['core', 'language', 'mathematics', 'science', 'social_science', 'arts', 'health', 'technology', 'other']).default('core')
});
const schoolCalendarEntrySchema = z.object({
  academicYearId: z.string().uuid().nullable().optional(),
  entryType: z.enum(['holiday', 'event', 'exam', 'closure']),
  titleEn: z.string().trim().min(2).max(160),
  titleAm: z.string().trim().min(2).max(160),
  startDate: z.string().date(),
  endDate: z.string().date(),
  isNonInstructionalDay: z.boolean().default(false),
  notesEn: z.string().trim().max(500).optional().default(''),
  notesAm: z.string().trim().max(500).optional().default('')
}).refine((entry) => entry.startDate <= entry.endDate, {
  message: 'Calendar entry end date cannot be before its start date.',
  path: ['endDate']
});
const curriculumUnitSchema = z.object({
  academicYearId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  subjectId: z.string().uuid(),
  stream: z.enum(['all', 'natural_science', 'social_science']).default('all'),
  unitNumber: z.number().int().min(1).max(200),
  titleEn: z.string().trim().min(2).max(160),
  titleAm: z.string().trim().min(2).max(160),
  learningOutcomesEn: z.string().trim().min(3).max(5000),
  learningOutcomesAm: z.string().trim().min(3).max(5000),
  plannedStart: z.string().date().nullable().optional(),
  plannedEnd: z.string().date().nullable().optional()
}).refine((unit) => !unit.plannedStart || !unit.plannedEnd || unit.plannedStart <= unit.plannedEnd, {
  message: 'Unit end date cannot be before its start date.',
  path: ['plannedEnd']
});
const lessonPlanSchema = z.object({
  teachingAssignmentId: z.string().uuid(),
  curriculumUnitId: z.string().uuid().nullable().optional(),
  plannedOn: z.string().date(),
  titleEn: z.string().trim().min(2).max(160),
  titleAm: z.string().trim().min(2).max(160),
  objectivesEn: z.string().trim().min(3).max(5000),
  objectivesAm: z.string().trim().min(3).max(5000),
  activitiesEn: z.string().trim().min(3).max(5000),
  activitiesAm: z.string().trim().min(3).max(5000),
  resources: z.string().trim().max(2000).optional().default('')
});
const lessonPlanUpdateSchema = z.object({
  titleEn: z.string().trim().min(2).max(160).optional(),
  titleAm: z.string().trim().min(2).max(160).optional(),
  objectivesEn: z.string().trim().min(3).max(5000).optional(),
  objectivesAm: z.string().trim().min(3).max(5000).optional(),
  activitiesEn: z.string().trim().min(3).max(5000).optional(),
  activitiesAm: z.string().trim().min(3).max(5000).optional(),
  resources: z.string().trim().max(2000).optional(),
  status: z.enum(['planned', 'completed', 'cancelled']).optional()
}).refine((plan) => Object.keys(plan).length > 0, {
  message: 'Provide at least one lesson plan field to update.'
});
const promotionRuleSchema = z.object({
  gradeLevelId: z.string().uuid(),
  minimumAnnualPercent: z.number().min(0).max(100),
  maximumFailedRequiredSubjects: z.number().int().min(0).max(12)
});
const departmentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().default('')
});
const staffSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().min(1).max(120),
  qualification: z.string().trim().max(255).optional().default(''),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).default('active'),
  hiredOn: z.string().date().nullable().optional()
});
const assignmentSchema = z.object({
  staffId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  roomId: z.string().uuid().nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
  periodNumber: z.number().int().min(1).max(20).nullable().optional()
}).refine((assignment) =>
  (assignment.dayOfWeek == null) === (assignment.periodNumber == null), {
  message: 'Set both timetable day and period, or leave both unset.',
  path: ['periodNumber']
});
const staffDateSchema = z.object({
  staffId: z.string().uuid().optional(),
  date: z.string().date(),
  status: z.enum(['present', 'absent', 'late', 'excused']),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()
});
const leaveSchema = z.object({
  staffId: z.string().uuid().optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  reason: z.string().trim().min(3).max(1000)
}).refine((leave) => leave.startDate <= leave.endDate, {
  message: 'Leave end date must be on or after the start date.',
  path: ['endDate']
});
const leaveReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional().default('')
});
const staffMessageSchema = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  type: z.enum(['handover', 'announcement']),
  title: z.string().trim().min(2).max(180),
  body: z.string().trim().min(1).max(10000)
});
const campusAnnouncementSchema = z.object({
  titleEn: z.string().trim().min(2).max(180),
  titleAm: z.string().trim().min(2).max(180),
  bodyEn: z.string().trim().min(1).max(10000),
  bodyAm: z.string().trim().min(1).max(10000)
});
const studentCommendationSchema = z.object({
  recordedOn: z.string().date(),
  titleEn: z.string().trim().min(2).max(180),
  titleAm: z.string().trim().min(2).max(180),
  descriptionEn: z.string().trim().min(1).max(2000),
  descriptionAm: z.string().trim().min(1).max(2000)
});
const campusEventSchema = z.object({
  titleEn: z.string().trim().min(2).max(180),
  titleAm: z.string().trim().min(2).max(180),
  descriptionEn: z.string().trim().max(5000).optional().default(''),
  descriptionAm: z.string().trim().max(5000).optional().default(''),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  startsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  endsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional().default(null),
  location: z.string().trim().max(180).optional().default('')
}).superRefine((event, context) => {
  if (event.startsOn > event.endsOn) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Event end date must not be before the start date.', path: ['endsOn'] });
  }
  if ((event.startsAt && !event.endsAt) || (!event.startsAt && event.endsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide both start and end times, or neither.', path: ['endsAt'] });
  } else if (event.startsOn === event.endsOn && event.startsAt && event.endsAt && event.startsAt >= event.endsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Event end time must be after the start time.', path: ['endsAt'] });
  }
});
const eventRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).superRefine((range, context) => {
  if (range.from > range.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Start date must not be after end date.', path: ['from'] });
  }
});
const moneyAmount = z.number().positive().max(99999999.99)
  .refine((value) => Number.isInteger(value * 100), 'Amount supports at most two decimal places.');
const feeItemSchema = z.object({
  code: z.string().trim().min(1).max(32),
  nameEn: z.string().trim().min(1).max(120),
  nameAm: z.string().trim().min(1).max(120),
  amount: moneyAmount,
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/)
});
const invoiceSchema = z.object({
  studentId: z.string().uuid(),
  dueDate: z.string().date().nullable().optional(),
  lines: z.array(z.object({
    feeItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000)
  })).min(1).max(30)
}).superRefine((invoice, context) => {
  const itemIds = invoice.lines.map((line) => line.feeItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Each fee item may appear only once; set its quantity instead.', path: ['lines'] });
  }
});
const feePaymentSchema = z.object({
  amount: moneyAmount,
  method: z.enum(['cash', 'bank_transfer', 'mobile_money', 'other']),
  reference: z.string().trim().max(120).optional().default('')
}).superRefine((payment, context) => {
  if (['bank_transfer', 'mobile_money'].includes(payment.method) && !payment.reference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A reference is required for bank transfer and mobile money.',
      path: ['reference']
    });
  }
});
const feeReversalSchema = z.object({
  amount: moneyAmount,
  reason: z.string().trim().min(3).max(500)
});
const invoiceVoidSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const feeItemUpdateSchema = feeItemSchema.extend({ isActive: z.boolean() });
const cashierShiftOpenSchema = z.object({
  openingFloat: z.number().nonnegative().max(99999999.99)
    .refine((value) => Number.isInteger(value * 100), 'Amount supports at most two decimal places.'),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/)
});
const cashierShiftCloseSchema = z.object({
  closingCash: z.number().nonnegative().max(99999999.99)
    .refine((value) => Number.isInteger(value * 100), 'Amount supports at most two decimal places.')
});
const feeExpenseSchema = z.object({
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(3).max(500),
  amount: moneyAmount,
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  method: z.enum(['cash', 'bank_transfer', 'mobile_money', 'other']),
  reference: z.string().trim().max(120).optional().default('')
}).superRefine((expense, context) => {
  if (['bank_transfer', 'mobile_money'].includes(expense.method) && !expense.reference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A reference is required for bank transfer and mobile money.',
      path: ['reference']
    });
  }
});
const feeReportRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).superRefine((range, context) => {
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000;
  if (range.from > range.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Start date must not be after end date.', path: ['from'] });
  } else if (days > 366) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Date range cannot exceed 367 calendar days.', path: ['to'] });
  }
});

const modulePathPrefixes = [
  ['student_information', ['/students', '/portal', '/account-invitations']],
  ['admissions', ['/admissions']],
  ['attendance', ['/attendance', '/staff/attendance', '/leave-requests']],
  ['marks', ['/marks', '/report-cards', '/grading']],
  ['fees', ['/fees', '/cashier']],
  ['communications', ['/communications', '/notifications']],
  ['staff', ['/staff', '/departments', '/teaching-assignments', '/homeroom-assignments', '/timetable']],
  ['academic_setup', ['/academic-year', '/academic-years', '/terms', '/grades', '/sections', '/subjects', '/curriculum', '/school-calendar', '/lesson-plans', '/promotion-rules']]
];
function moduleForApiPath(pathname) {
  return modulePathPrefixes.find(([, prefixes]) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))?.[0] ?? null;
}

const permissionRoles = {
  'dashboard.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'account.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin', 'student', 'parent_guardian', 'auditor'],
  'accounts.manage': ['owner_director', 'principal', 'registrar', 'hr_admin', 'system_admin'],
  'portal.view': ['student', 'parent_guardian'],
  'platform.view': ['super_admin'],
  'platform.manage': ['super_admin'],
  'school.export': ['owner_director'],
  'school.close': ['owner_director'],
  'students.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'counsellor', 'system_admin'],
  'students.alumni.view': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.progression.override': ['owner_director', 'principal', 'system_admin'],
  'students.edit': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.sensitive.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.sensitive.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.discipline.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.discipline.manage': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'students.transfer.approve': ['owner_director', 'principal', 'system_admin'],
  'students.emergency.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.emergency.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.guardians.view': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.guardians.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.commendations.view': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'students.commendations.manage': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'admissions.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'admissions.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'school.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'school.edit': ['owner_director', 'principal', 'system_admin'],
  'lesson_plans.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'lesson_plans.manage': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.take': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.edit': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.corrections.review': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'marks.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.enter': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.approve': ['owner_director', 'principal', 'academic_head', 'system_admin'],
  'marks.publish': ['owner_director', 'principal', 'system_admin'],
  'marks.amend': ['owner_director', 'principal', 'system_admin'],
  'fees.view': ['owner_director', 'principal', 'registrar', 'accountant_cashier', 'system_admin'],
  'fees.manage': ['owner_director', 'principal', 'system_admin'],
  'fees.collect': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.reverse': ['owner_director', 'principal', 'system_admin'],
  'fees.shifts': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.expenses.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.expenses.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.reports.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'staff.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'staff.manage': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'assignments.manage': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'system_admin'],
  'staff.attendance': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.request': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.approve': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'staff.messages': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'communications.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'communications.manage': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'notifications.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin']
};
function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new Error('Request validation failed.');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    error.details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'), message: issue.message
    }));
    throw error;
  }
  return result.data;
}

function studentCsvError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

function parseStudentCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw studentCsvError('Upload a non-empty CSV file.');
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        quoteClosed = true;
      } else {
        field += character;
      }
      continue;
    }
    if (quoteClosed && character !== ',' && character !== '\r' && character !== '\n' && !/\s/.test(character)) {
      throw studentCsvError('CSV contains unexpected text after a quoted field.');
    }
    if (character === ',' || character === '\r' || character === '\n') {
      record.push(field.trim());
      field = '';
      quoteClosed = false;
      if (character !== ',') {
        if (character === '\r' && csv[index + 1] === '\n') index += 1;
        if (record.some((value) => value !== '')) records.push(record);
        record = [];
      }
    } else if (character === '"' && field === '') {
      quoted = true;
    } else if (character === '"') {
      throw studentCsvError('CSV contains a quote inside an unquoted field; escape quotes by doubling them.');
    } else {
      field += character;
    }
  }
  if (quoted) throw studentCsvError('CSV contains an unclosed quoted field.');
  record.push(field.trim());
  if (record.some((value) => value !== '')) records.push(record);
  if (records.length < 2) throw studentCsvError('CSV must contain a header and at least one student row.');

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header).trim());
  const allowedHeaders = new Set([
    'studentNo', 'givenNameAm', 'fatherNameAm', 'grandfatherNameAm',
    'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'gender',
    'dateOfBirth', 'guardianPhone', 'previousSchool', 'sectionName'
  ]);
  const requiredHeaders = [
    'studentNo', 'givenNameAm', 'fatherNameAm', 'grandfatherNameAm',
    'givenNameEn', 'fatherNameEn', 'grandfatherNameEn', 'gender', 'sectionName'
  ];
  if (headers.some((header) => !header || !allowedHeaders.has(header))) {
    throw studentCsvError('CSV has an empty or unsupported column. Use the provided student import template.');
  }
  if (new Set(headers).size !== headers.length) throw studentCsvError('CSV contains duplicate column names.');
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) throw studentCsvError(`CSV is missing required columns: ${missingHeaders.join(', ')}.`);
  const dataRows = [];
  const rowReports = [];
  const rawRows = records.slice(1);
  if (rawRows.length > 600) throw studentCsvError('A student import can contain at most 600 rows.');
  for (const [index, values] of rawRows.entries()) {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      rowReports.push({
        rowNumber, eligible: false, errors: [{
          field: '', message: `Expected ${headers.length} columns but found ${values.length}.`
        }], warnings: []
      });
      continue;
    }
    const input = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    for (const optional of ['dateOfBirth', 'guardianPhone', 'previousSchool']) {
      if (!input[optional]) input[optional] = null;
    }
    const result = studentSchema.safeParse(input);
    if (!result.success) {
      rowReports.push({
        rowNumber, eligible: false,
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join('.'), message: issue.message
        })),
        warnings: []
      });
      continue;
    }
    dataRows.push({ rowNumber, data: result.data });
  }
  return { dataRows, rowReports, totalRows: rawRows.length };
}

async function previewStudentCsv(repo, csv, actor) {
  const parsed = parseStudentCsv(csv);
  const businessReports = await repo.previewStudentImport(parsed.dataRows, actor);
  const reportsByRow = new Map([...parsed.rowReports, ...businessReports].map((report) =>
    [report.rowNumber, report]));
  const rows = [...reportsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);
  return {
    ...parsed, rows,
    eligibleCount: rows.filter((row) => row.eligible).length,
    invalidCount: rows.filter((row) => !row.eligible).length,
    warningCount: rows.filter((row) => row.warnings.length > 0).length
  };
}

export function createApp({ repo, config, mailer = null }) {
  const app = express();
  const webOrigins = [...new Set([config.WEB_ORIGIN, ...(config.WEB_ALLOWED_ORIGINS ?? [])])];
  app.disable('x-powered-by');
  app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", ...webOrigins],
        fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"]
      }
    }
  }));
  app.use(cors({
    origin: webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use((request, response, next) => {
    response.setHeader('X-Request-Id', request.headers['x-request-id']?.toString().slice(0, 100) ?? cryptoRandomId());
    next();
  });
  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false
  }));

  app.get('/api/health', (request, response) => {
    response.json({ data: { status: 'ok', service: 'sims-api', storage: repo.mode, timestamp: new Date().toISOString() } });
  });

  app.get('/api/public/admissions/:token', rateLimit({
    windowMs: 15 * 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false
  }), async (request, response, next) => {
    try {
      const token = parse(z.string().regex(/^[a-f0-9]{64}$/), request.params.token);
      const info = await repo.getPublicAdmissionInfo(token);
      if (!info) return response.status(404).json({ error: { code: 'ADMISSIONS_LINK_NOT_FOUND', message: 'This school application link is unavailable.' } });
      response.set('Cache-Control', 'no-store').json({ data: info });
    } catch (error) { next(error); }
  });
  app.post('/api/public/admissions/:token', rateLimit({
    windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false
  }), async (request, response, next) => {
    try {
      const token = parse(z.string().regex(/^[a-f0-9]{64}$/), request.params.token);
      const { privacyConsent: _privacyConsent, ...application } =
        parse(publicAdmissionSchema, request.body);
      const result = await repo.createPublicAdmission(token, application);
      if (!result) return response.status(404).json({ error: { code: 'ADMISSIONS_LINK_NOT_FOUND', message: 'This school application link is unavailable.' } });
      response.set('Cache-Control', 'no-store').status(201).json({
        data: { reference: result.id, message: 'Your application was submitted to the school.' }
      });
    } catch (error) { next(error); }
  });
  app.get('/api/public/student-transfers/:token', rateLimit({
    windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false
  }), async (request, response, next) => {
    try {
      const token = parse(z.string().regex(/^[A-Za-z0-9_-]{43}$/), request.params.token);
      const packet = await repo.getStudentTransferPackageByTokenHash(
        createHash('sha256').update(token).digest('hex')
      );
      if (!packet) return response.status(404).json({ error: { code: 'TRANSFER_PACKAGE_NOT_FOUND', message: 'This transfer link is invalid or expired.' } });
      response.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer')
        .json({ data: packet });
    } catch (error) { next(error); }
  });

  app.post('/api/school-registration', rateLimit({
    windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false
  }), async (request, response, next) => {
    try {
      const input = parse(schoolRegistrationSchema, request.body);
      const passwordHash = await bcrypt.hash(input.password, 12);
      const { password: _password, confirmPassword: _confirmPassword, ...registration } = input;
      const result = await repo.registerSchool(registration, passwordHash);
      response.status(201).json({
        data: {
          ...result,
          message: 'Your school is registered and its Starter trial is active. You can sign in now.'
        }
      });
    } catch (error) { next(error); }
  });

  registerPublicAuthRoutes(app, { repo, config, mailer, parse });

  app.use('/api', authenticate(config, repo), async (request, response, next) => {
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
  app.get('/api/school-calendar', requirePermission('school.view'), async (request, response, next) => {
    try {
      const filters = parse(z.object({
        from: z.string().date().optional(), to: z.string().date().optional()
      }).refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: 'Calendar range start must not be after end.'
      }), request.query);
      response.json({ data: await repo.listSchoolCalendarEntries(request.user.activeCampusId, filters) });
    } catch (error) { next(error); }
  });
  app.post('/api/school-calendar', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const entry = await repo.createSchoolCalendarEntry(
        parse(schoolCalendarEntrySchema, request.body), request.user
      );
      response.status(201).json({ data: entry });
    } catch (error) { next(error); }
  });
  app.put('/api/school-calendar/:entryId', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const entry = await repo.updateSchoolCalendarEntry(
        parse(z.string().uuid(), request.params.entryId),
        parse(schoolCalendarEntrySchema, request.body), request.user
      );
      if (!entry) return response.status(404).json({ error: { code: 'CALENDAR_ENTRY_NOT_FOUND', message: 'Calendar entry not found.' } });
      response.json({ data: entry });
    } catch (error) { next(error); }
  });
  app.delete('/api/school-calendar/:entryId', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const deleted = await repo.deleteSchoolCalendarEntry(
        parse(z.string().uuid(), request.params.entryId), request.user
      );
      if (!deleted) return response.status(404).json({ error: { code: 'CALENDAR_ENTRY_NOT_FOUND', message: 'Calendar entry not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  });
  registerAuthenticatedAuthRoutes(app, { repo, config, parse, requirePermission });
  registerAccountRoutes(app, { repo, parse, requirePermission });
  app.get('/api/dashboard', requirePermission('dashboard.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getDashboard(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.get('/api/portal/home', requirePermission('portal.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getPortalHome(request.user) });
    } catch (error) { next(error); }
  });

  registerPlatformRoutes(app, { repo, parse, requirePermission });
  registerAccountInvitationRoute(app, {
    repo, config, parse, requirePermission, permissionRoles
  });
  registerPlatformLicenceRoutes(app, { requirePermission });
  app.get('/api/school', requirePermission('school.view'), async (request, response, next) => {
    try {
      const campus = await repo.getCampus(request.user.activeCampusId);
      if (!campus) return response.status(404).json({ error: { code: 'CAMPUS_NOT_FOUND', message: 'Campus not found.' } });
      response.json({ data: campus });
    } catch (error) { next(error); }
  });
  app.get('/api/school/settings', requirePermission('school.view'), async (request, response, next) => {
    try {
      const settings = await repo.getOrganizationSettings(request.user.orgId);
      if (!settings) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.json({ data: settings });
    } catch (error) { next(error); }
  });
  app.put('/api/school/settings', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const settings = await repo.updateOrganizationSettings(
        parse(organizationSettingsSchema, request.body), request.user
      );
      if (!settings) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.json({ data: settings });
    } catch (error) { next(error); }
  });
  app.get('/api/school/subscription', requirePermission('school.view'), async (request, response, next) => {
    try { response.json({ data: await repo.getOrganizationSubscription(request.user.orgId) }); }
    catch (error) { next(error); }
  });
  app.post('/api/school/closure', requirePermission('school.close'), async (request, response, next) => {
    try {
      const closure = await repo.requestOrganizationClosure(parse(closureRequestSchema, request.body), request.user);
      response.status(202).json({ data: closure });
    } catch (error) { next(error); }
  });
  app.get('/api/school/export', requirePermission('school.export'), async (request, response, next) => {
    try {
      const data = await repo.getOrganizationExport(request.user.orgId);
      if (!data) return response.status(404).json({
        error: { code: 'SCHOOL_NOT_FOUND', message: 'School tenant not found.' }
      });
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Disposition', 'attachment; filename="school-data-export.json"');
      response.once('finish', () => {
        repo.markOrganizationExported(request.user.orgId, request.user).catch((markError) => {
          logger.error({ err: markError, organizationId: request.user.orgId }, 'School export completed but closure export status could not be recorded');
        });
      });
      response.type('application/json').send(JSON.stringify(data));
    } catch (error) { next(error); }
  });
  app.get('/api/academic-year', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getAcademicYear(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.get('/api/academic-years', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listAcademicYears(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/academic-years', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const year = await repo.createAcademicYear(parse(academicYearSchema, request.body), request.user);
      response.status(201).json({ data: year });
    } catch (error) { next(error); }
  });
  app.patch('/api/academic-years/:yearId/activate', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const yearId = parse(academicYearIdSchema, request.params.yearId);
      const year = await repo.activateAcademicYear(yearId, request.user);
      if (!year) return response.status(404).json({ error: { code: 'ACADEMIC_YEAR_NOT_FOUND', message: 'Academic year not found.' } });
      response.json({ data: year });
    } catch (error) { next(error); }
  });
  app.get('/api/terms', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listTerms(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/terms', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const term = await repo.createTerm(parse(termSchema, request.body), request.user);
      response.status(201).json({ data: term });
    } catch (error) { next(error); }
  });
  app.patch('/api/terms/:termId/current', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const termId = parse(academicYearIdSchema, request.params.termId);
      const term = await repo.setCurrentTerm(termId, request.user);
      if (!term) return response.status(404).json({
        error: { code: 'TERM_NOT_FOUND', message: 'Term not found in the active academic year.' }
      });
      response.json({ data: term });
    } catch (error) { next(error); }
  });
  app.get('/api/grades', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listGrades(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.get('/api/curriculum/grades', requirePermission('school.view'), (_request, response) => {
    response.json({ data: SCHOOL_GRADE_CATALOG });
  });
  app.get('/api/curriculum/units', requirePermission('school.view'), async (request, response, next) => {
    try {
      const filters = parse(z.object({
        academicYearId: z.string().uuid().optional(),
        gradeLevelId: z.string().uuid().optional(),
        subjectId: z.string().uuid().optional()
      }), request.query);
      response.json({ data: await repo.listCurriculumUnits(request.user.activeCampusId, filters) });
    } catch (error) { next(error); }
  });
  app.post('/api/curriculum/units', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const unit = await repo.saveCurriculumUnit(
        parse(curriculumUnitSchema, request.body), request.user
      );
      response.status(201).json({ data: unit });
    } catch (error) { next(error); }
  });
  app.put('/api/curriculum/units/:unitId', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const unit = await repo.saveCurriculumUnit(
        parse(curriculumUnitSchema, request.body), request.user,
        parse(z.string().uuid(), request.params.unitId)
      );
      if (!unit) return response.status(404).json({ error: { code: 'CURRICULUM_UNIT_NOT_FOUND', message: 'Curriculum unit not found.' } });
      response.json({ data: unit });
    } catch (error) { next(error); }
  });
  app.delete('/api/curriculum/units/:unitId', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const deleted = await repo.deleteCurriculumUnit(
        parse(z.string().uuid(), request.params.unitId), request.user
      );
      if (!deleted) return response.status(404).json({ error: { code: 'CURRICULUM_UNIT_NOT_FOUND', message: 'Curriculum unit not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  });
  app.post('/api/grades', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const grade = await repo.createGrade(parse(gradeSchema, request.body), request.user);
      response.status(201).json({ data: grade });
    } catch (error) { next(error); }
  });
  app.get('/api/grades/:gradeId/subjects', requirePermission('school.view'), async (request, response, next) => {
    try {
      const gradeId = parse(z.string().uuid(), request.params.gradeId);
      const stream = request.query.stream
        ? parse(z.enum(['natural_science', 'social_science']), request.query.stream)
        : undefined;
      response.json({ data: await repo.listGradeSubjects(request.user.activeCampusId, gradeId, stream) });
    } catch (error) { next(error); }
  });
  app.put('/api/grades/:gradeId/subjects', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const gradeId = parse(z.string().uuid(), request.params.gradeId);
      const subjects = await repo.replaceGradeSubjects(gradeId, parse(gradeSubjectsSchema, request.body), request.user);
      response.json({ data: subjects });
    } catch (error) { next(error); }
  });
  app.get('/api/subjects', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listSubjects(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/subjects', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const subject = await repo.createSubject(parse(subjectSchema, request.body), request.user);
      response.status(201).json({ data: subject });
    } catch (error) { next(error); }
  });
  app.get('/api/promotion-rules', requirePermission('school.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listPromotionRules(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.put('/api/grades/:gradeId/promotion-rule', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const gradeLevelId = parse(z.string().uuid(), request.params.gradeId);
      const input = parse(promotionRuleSchema, { ...request.body, gradeLevelId });
      response.json({ data: await repo.savePromotionRule(input, request.user) });
    } catch (error) { next(error); }
  });
  app.get('/api/departments', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listDepartments(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/departments', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const department = await repo.createDepartment(parse(departmentSchema, request.body), request.user);
      response.status(201).json({ data: department });
    } catch (error) { next(error); }
  });
  app.get('/api/staff', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaff(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/staff', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const staff = await repo.createStaff(parse(staffSchema, request.body), request.user);
      response.status(201).json({ data: staff });
    } catch (error) { next(error); }
  });
  app.get('/api/teaching-assignments', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listTeachingAssignments(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/teaching-assignments', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const assignment = await repo.createTeachingAssignment(parse(assignmentSchema, request.body), request.user);
      response.status(201).json({ data: assignment });
    } catch (error) { next(error); }
  });
  app.get('/api/lesson-plans', requirePermission('lesson_plans.view'), async (request, response, next) => {
    try {
      const filters = parse(z.object({
        from: z.string().date().optional(), to: z.string().date().optional(),
        sectionId: z.string().uuid().optional()
      }).refine((value) => !value.from || !value.to || value.from <= value.to, {
        message: 'Lesson plan range start must not be after end.'
      }), request.query);
      response.json({ data: await repo.listLessonPlans(request.user, filters) });
    } catch (error) { next(error); }
  });
  app.post('/api/lesson-plans', requirePermission('lesson_plans.manage'), async (request, response, next) => {
    try {
      const plan = await repo.createLessonPlan(parse(lessonPlanSchema, request.body), request.user);
      response.status(201).json({ data: plan });
    } catch (error) { next(error); }
  });
  app.put('/api/lesson-plans/:lessonPlanId', requirePermission('lesson_plans.manage'), async (request, response, next) => {
    try {
      const plan = await repo.updateLessonPlan(
        parse(z.string().uuid(), request.params.lessonPlanId),
        parse(lessonPlanUpdateSchema, request.body), request.user
      );
      if (!plan) return response.status(404).json({ error: { code: 'LESSON_PLAN_NOT_FOUND', message: 'Lesson plan not found.' } });
      response.json({ data: plan });
    } catch (error) { next(error); }
  });
  app.get('/api/timetable/periods', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listTimetablePeriods(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/timetable/periods', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const period = await repo.createTimetablePeriod(parse(timetablePeriodSchema, request.body), request.user);
      response.status(201).json({ data: period });
    } catch (error) { next(error); }
  });
  app.get('/api/timetable/rooms', requirePermission('staff.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listRooms(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/timetable/rooms', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const room = await repo.createRoom(parse(roomSchema, request.body), request.user);
      response.status(201).json({ data: room });
    } catch (error) { next(error); }
  });
  app.get('/api/timetable', requirePermission('staff.view'), async (request, response, next) => {
    try {
      const query = parse(timetableQuerySchema, request.query);
      response.json({ data: await repo.listTimetable(request.user, query) });
    } catch (error) { next(error); }
  });
  app.post('/api/timetable/assignments/:assignmentId/substitutions', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const assignmentId = parse(z.string().uuid(), request.params.assignmentId);
      const substitution = await repo.createTimetableSubstitution(
        assignmentId, parse(substituteSchema, request.body), request.user
      );
      if (!substitution) return response.status(404).json({ error: { code: 'TIMETABLE_ASSIGNMENT_NOT_FOUND', message: 'Timetable assignment not found.' } });
      response.status(201).json({ data: substitution });
    } catch (error) { next(error); }
  });
  app.put('/api/sections/:sectionId/homeroom', requirePermission('assignments.manage'), async (request, response, next) => {
    try {
      const input = parse(z.object({ staffId: z.string().uuid() }), request.body);
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const assignment = await repo.assignHomeroom(sectionId, input.staffId, request.user);
      if (!assignment) return response.status(404).json({ error: { code: 'SECTION_NOT_FOUND', message: 'Section not found.' } });
      response.json({ data: assignment });
    } catch (error) { next(error); }
  });
  app.get('/api/staff/attendance', requirePermission('staff.attendance'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaffAttendance(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/staff/attendance', requirePermission('staff.attendance'), async (request, response, next) => {
    try {
      const record = await repo.recordStaffAttendance(parse(staffDateSchema, request.body), request.user);
      response.status(record.duplicate ? 200 : 201).json({ data: record });
    } catch (error) { next(error); }
  });
  app.get('/api/staff/attendance.csv', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const rows = await repo.listStaffAttendance(request.user);
      response.set('Content-Type', 'text/csv; charset=utf-8');
      response.attachment('staff-attendance.csv');
      response.send(toCsv([
        ['Staff ID', 'Name', 'Department', 'Date', 'Status', 'Clock in', 'Clock out'],
        ...rows.map((row) => [
          row.staffId, row.name, row.department ?? '', row.date, row.status,
          row.clockIn ?? '', row.clockOut ?? ''
        ])
      ]));
    } catch (error) { next(error); }
  });
  app.get('/api/leave-requests', requirePermission('leave.request'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listLeaveRequests(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/leave-requests', requirePermission('leave.request'), async (request, response, next) => {
    try {
      const leave = await repo.createLeaveRequest(parse(leaveSchema, request.body), request.user);
      response.status(201).json({ data: leave });
    } catch (error) { next(error); }
  });
  app.patch('/api/leave-requests/:leaveId', requirePermission('leave.approve'), async (request, response, next) => {
    try {
      const leaveId = parse(z.string().uuid(), request.params.leaveId);
      const input = parse(leaveReviewSchema, request.body);
      const leave = await repo.reviewLeaveRequest(leaveId, input, request.user);
      if (!leave) return response.status(404).json({ error: { code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' } });
      response.json({ data: leave });
    } catch (error) { next(error); }
  });
  app.get('/api/staff/messages', requirePermission('staff.messages'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStaffMessages(request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/staff/messages', requirePermission('staff.manage'), async (request, response, next) => {
    try {
      const message = await repo.createStaffMessage(parse(staffMessageSchema, request.body), request.user);
      response.status(201).json({ data: message });
    } catch (error) { next(error); }
  });
  app.get('/api/communications/announcements', requirePermission('communications.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listCampusAnnouncements(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.post('/api/communications/announcements', requirePermission('communications.manage'), async (request, response, next) => {
    try {
      const announcement = await repo.createCampusAnnouncement(
        parse(campusAnnouncementSchema, request.body), request.user
      );
      response.status(201).json({ data: announcement });
    } catch (error) { next(error); }
  });
  app.get('/api/communications/events', requirePermission('communications.view'), async (request, response, next) => {
    try {
      const today = addisDate();
      const range = parse(eventRangeSchema, {
        from: request.query.from ?? today,
        to: request.query.to ?? addDays(today, 365)
      });
      response.json({ data: await repo.listCampusEvents(
        request.user.activeCampusId, range.from, range.to
      ) });
    } catch (error) { next(error); }
  });
  app.post('/api/communications/events', requirePermission('communications.manage'), async (request, response, next) => {
    try {
      const event = await repo.createCampusEvent(parse(campusEventSchema, request.body), request.user);
      response.status(201).json({ data: event });
    } catch (error) { next(error); }
  });
  app.get('/api/notifications', requirePermission('notifications.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listUserNotifications(request.user) });
    } catch (error) { next(error); }
  });
  app.patch('/api/notifications/:notificationId/read', requirePermission('notifications.view'), async (request, response, next) => {
    try {
      const id = parse(z.string().uuid(), request.params.notificationId);
      const notification = await repo.markUserNotificationRead(id, request.user);
      if (!notification) {
        return response.status(404).json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found.' } });
      }
      response.json({ data: notification });
    } catch (error) { next(error); }
  });
  app.post('/api/sections', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const section = await repo.createSection(parse(sectionSchema, request.body), request.user);
      response.status(201).json({ data: section });
    } catch (error) { next(error); }
  });
  app.patch('/api/sections/:sectionId/capacity', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const section = await repo.updateSectionCapacity(sectionId, parse(sectionCapacitySchema, request.body), request.user);
      if (!section) return response.status(404).json({ error: { code: 'SECTION_NOT_FOUND', message: 'Section not found.' } });
      response.json({ data: section });
    } catch (error) { next(error); }
  });
  app.put('/api/school', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const campus = await repo.updateCampus(parse(schoolProfileSchema, request.body), request.user);
      if (!campus) return response.status(404).json({ error: { code: 'CAMPUS_NOT_FOUND', message: 'Campus not found.' } });
      response.json({ data: campus });
    } catch (error) { next(error); }
  });
  app.get('/api/admissions/dashboard', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getAdmissionsDashboard(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.get('/api/admissions/public-link', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const token = await repo.getAdmissionsPublicToken(request.user.activeCampusId);
      if (!token) return response.status(404).json({ error: { code: 'ADMISSIONS_LINK_UNAVAILABLE', message: 'A public admissions link is not configured for this campus.' } });
      response.json({ data: { token } });
    } catch (error) { next(error); }
  });
  app.get('/api/admissions/duplicates', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const search = parse(z.object({
        name: z.string().trim().min(2).max(180).optional(),
        dateOfBirth: z.string().date().optional(),
        guardianPhone: z.string().trim().min(7).max(32).optional()
      }).refine((value) => Boolean(value.name || value.guardianPhone), {
        message: 'Provide a name or guardian phone to search for duplicates.'
      }), request.query);
      response.json({ data: await repo.findAdmissionDuplicates(request.user.activeCampusId, search) });
    } catch (error) { next(error); }
  });
  app.get('/api/admissions', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const status = request.query.status
        ? parse(z.enum(['enquiry', 'application', 'interview', 'accepted', 'waitlisted', 'rejected', 'enrolled', 'withdrawn', 'transferred_out']), request.query.status)
        : null;
      const query = request.query.q ? parse(z.string().trim().max(180), request.query.q) : '';
      response.json({ data: await repo.listAdmissions(request.user.activeCampusId, { status, query }) });
    } catch (error) { next(error); }
  });
  app.post('/api/admissions', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const admission = await repo.createAdmission(parse(admissionSchema, request.body), request.user);
      response.status(201).json({ data: admission });
    } catch (error) { next(error); }
  });
  app.put('/api/admissions/student-id-pattern', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      response.json({ data: await repo.setStudentIdPattern(parse(studentIdPatternSchema, request.body).pattern, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/admissions/:admissionId/interview', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.scheduleAdmissionInterview(
        parse(z.string().uuid(), request.params.admissionId), parse(interviewSchema, request.body), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'ADMISSION_NOT_FOUND', message: 'Admission record not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.patch('/api/admissions/:admissionId/status', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.updateAdmissionStatus(
        parse(z.string().uuid(), request.params.admissionId), parse(admissionStatusSchema, request.body), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'ADMISSION_NOT_FOUND', message: 'Admission record not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.post('/api/admissions/:admissionId/enrol', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.enrolAdmission(
        parse(z.string().uuid(), request.params.admissionId), parse(admissionEnrolmentSchema, request.body), request.user
      );
      response.set('Cache-Control', 'no-store').status(201).json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/admissions/:admissionId/documents', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const admissionId = parse(z.string().uuid(), request.params.admissionId);
      const documents = await repo.listAdmissionDocuments(request.user.activeCampusId, admissionId);
      response.json({ data: documents });
    } catch (error) { next(error); }
  });
  app.post('/api/admissions/:admissionId/documents', requirePermission('admissions.manage'),
    express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }),
    async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return response.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Upload a non-empty PDF, JPEG, or PNG document.' } });
        }
        const document = await repo.storeAdmissionDocument(
          parse(z.string().uuid(), request.params.admissionId),
          parse(z.enum(['birth_certificate', 'previous_school_report', 'guardian_id', 'other']), request.query.type),
          parse(z.string().trim().min(1).max(180), request.query.name),
          request.headers['content-type'],
          request.body,
          request.user
        );
        response.status(201).json({ data: document });
      } catch (error) { next(error); }
    });
  app.get('/api/admissions/:admissionId/documents/:documentId', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const result = await repo.getAdmissionDocument(
        request.user.activeCampusId, parse(z.string().uuid(), request.params.admissionId),
        parse(z.string().uuid(), request.params.documentId)
      );
      if (!result) return response.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' } });
      response.type(result.document.mimeType).attachment(result.document.originalName).send(result.content);
    } catch (error) { next(error); }
  });
  app.get('/api/admissions/:admissionId/offer-letter', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const admission = await repo.getAdmission(request.user.activeCampusId, parse(z.string().uuid(), request.params.admissionId));
      if (!admission) return response.status(404).json({ error: { code: 'ADMISSION_NOT_FOUND', message: 'Admission record not found.' } });
      if (admission.status !== 'accepted') return response.status(409).json({ error: { code: 'OFFER_NOT_READY', message: 'An offer letter is available only for accepted applicants.' } });
      response.type('html').send(offerLetterHtml(admission));
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/withdraw', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.changeStudentStatus(
        parse(z.string().uuid(), request.params.studentId), 'withdrawn',
        parse(studentStatusSchema, request.body).reason, request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/readmit', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.readmitStudent(
        parse(z.string().uuid(), request.params.studentId),
        parse(z.object({ sectionId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }), request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/transfer-out', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.transferStudentOut(
        parse(z.string().uuid(), request.params.studentId), parse(studentStatusSchema, request.body).reason, request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/enrolments', requirePermission('students.view'), async (request, response, next) => {
    try {
      const result = await repo.listStudentEnrollmentHistory(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (result === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/section-transfer', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.transferStudentSection(
        parse(z.string().uuid(), request.params.studentId),
        parse(z.object({
          sectionId: z.string().uuid(), reason: z.string().trim().min(3).max(500)
        }), request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/section-transfers', requirePermission('students.view'), async (request, response, next) => {
    try {
      const result = await repo.listStudentSectionTransfers(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (result === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/progression', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.advanceStudent(
        parse(z.string().uuid(), request.params.studentId),
        parse(studentProgressionSchema, request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/progression-eligibility', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const result = await repo.evaluateStudentProgression(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/transfer-certificate', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const result = await repo.getStudentTransferRecord(
        request.user.activeCampusId, parse(z.string().uuid(), request.params.studentId)
      );
      if (!result) return response.status(404).json({ error: { code: 'TRANSFER_NOT_FOUND', message: 'No transfer-out record was found.' } });
      response.type('html').send(transferCertificateHtml(result));
    } catch (error) { next(error); }
  });
  app.get('/api/fees/items', requirePermission('fees.view'), async (request, response, next) => {
    try { response.json({ data: await repo.listFeeItems(request.user.activeCampusId) }); }
    catch (error) { next(error); }
  });
  app.get('/api/fees/shifts/current', requirePermission('fees.shifts'), async (request, response, next) => {
    try { response.json({ data: await repo.getActiveCashierShift(request.user) }); }
    catch (error) { next(error); }
  });
  app.get('/api/fees/shifts', requirePermission('fees.shifts'), async (request, response, next) => {
    try { response.json({ data: await repo.listCashierShifts(request.user) }); }
    catch (error) { next(error); }
  });
  app.post('/api/fees/shifts', requirePermission('fees.shifts'), async (request, response, next) => {
    try {
      const shift = await repo.openCashierShift(parse(cashierShiftOpenSchema, request.body), request.user);
      response.status(201).json({ data: shift });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/shifts/:shiftId/close', requirePermission('fees.shifts'), async (request, response, next) => {
    try {
      const shiftId = parse(z.string().uuid(), request.params.shiftId);
      const shift = await repo.closeCashierShift(shiftId, parse(cashierShiftCloseSchema, request.body), request.user);
      if (!shift) return response.status(404).json({ error: { code: 'SHIFT_NOT_FOUND', message: 'Open cashier shift not found.' } });
      response.json({ data: shift });
    } catch (error) { next(error); }
  });
  app.get('/api/fees/expenses', requirePermission('fees.expenses.view'), async (request, response, next) => {
    try {
      const range = parse(feeReportRangeSchema, { from: request.query.from, to: request.query.to });
      response.json({ data: await repo.listFeeExpenses(request.user.activeCampusId, range.from, range.to) });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/expenses', requirePermission('fees.expenses.manage'), async (request, response, next) => {
    try {
      const expense = await repo.createFeeExpense(parse(feeExpenseSchema, request.body), request.user);
      response.status(201).json({ data: expense });
    } catch (error) { next(error); }
  });
  app.get('/api/fees/summary', requirePermission('fees.reports.view'), async (request, response, next) => {
    try {
      const range = parse(feeReportRangeSchema, { from: request.query.from, to: request.query.to });
      const totals = await repo.getFeeSummary(request.user.activeCampusId, range.from, range.to);
      response.json({ data: { ...range, totals } });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/items', requirePermission('fees.manage'), async (request, response, next) => {
    try {
      const item = await repo.createFeeItem(parse(feeItemSchema, request.body), request.user);
      response.status(201).json({ data: item });
    } catch (error) { next(error); }
  });
  app.put('/api/fees/items/:itemId', requirePermission('fees.manage'), async (request, response, next) => {
    try {
      const itemId = parse(z.string().uuid(), request.params.itemId);
      const item = await repo.updateFeeItem(itemId, parse(feeItemUpdateSchema, request.body), request.user);
      if (!item) return response.status(404).json({ error: { code: 'FEE_ITEM_NOT_FOUND', message: 'Fee item not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.get('/api/fees/invoices', requirePermission('fees.view'), async (request, response, next) => {
    try {
      const studentId = request.query.studentId == null ? undefined : parse(z.string().uuid(), request.query.studentId);
      response.json({ data: await repo.listFeeInvoices(request.user.activeCampusId, studentId) });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/invoices', requirePermission('fees.manage'), async (request, response, next) => {
    try {
      const invoice = await repo.createFeeInvoice(parse(invoiceSchema, request.body), request.user);
      response.status(201).json({ data: invoice });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/invoices/:invoiceId/void', requirePermission('fees.manage'), async (request, response, next) => {
    try {
      const invoiceId = parse(z.string().uuid(), request.params.invoiceId);
      const invoice = await repo.voidFeeInvoice(invoiceId, parse(invoiceVoidSchema, request.body), request.user);
      if (!invoice) return response.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' } });
      response.json({ data: invoice });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/invoices/:invoiceId/payments', requirePermission('fees.collect'), async (request, response, next) => {
    try {
      const invoiceId = parse(z.string().uuid(), request.params.invoiceId);
      const payment = await repo.recordFeePayment(invoiceId, parse(feePaymentSchema, request.body), request.user);
      if (!payment) return response.status(404).json({ error: { code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' } });
      response.status(201).json({ data: payment });
    } catch (error) { next(error); }
  });
  app.post('/api/fees/payments/:paymentId/reversals', requirePermission('fees.reverse'), async (request, response, next) => {
    try {
      const paymentId = parse(z.string().uuid(), request.params.paymentId);
      const reversal = await repo.reverseFeePayment(paymentId, parse(feeReversalSchema, request.body), request.user);
      if (!reversal) return response.status(404).json({ error: { code: 'PAYMENT_NOT_FOUND', message: 'Payment not found.' } });
      response.status(201).json({ data: reversal });
    } catch (error) { next(error); }
  });
  app.get('/api/fees/receipts/:receiptNumber', requirePermission('fees.view'), async (request, response, next) => {
    try {
      const receiptNumber = parse(z.string().regex(/^RCP-[A-F0-9]{12}$/), request.params.receiptNumber);
      const receipt = await repo.getFeeReceipt(request.user.activeCampusId, receiptNumber);
      if (!receipt) return response.status(404).json({ error: { code: 'RECEIPT_NOT_FOUND', message: 'Receipt not found.' } });
      response.json({ data: receipt });
    } catch (error) { next(error); }
  });
  app.get('/api/students', requirePermission('students.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listStudentsFor(request.user) });
    } catch (error) { next(error); }
  });
  app.get('/api/alumni', requirePermission('students.alumni.view'), async (request, response, next) => {
    try {
      response.json({ data: (await repo.listStudentsFor(request.user))
        .filter((student) => student.status === 'graduated') });
    } catch (error) { next(error); }
  });
  app.post('/api/students/import/preview', requirePermission('students.edit'),
    express.text({ type: 'text/csv', limit: '1mb' }), async (request, response, next) => {
      try {
        const preview = await previewStudentCsv(repo, request.body, request.user);
        response.set('Cache-Control', 'no-store').json({ data: {
          totalRows: preview.totalRows, eligibleCount: preview.eligibleCount,
          invalidCount: preview.invalidCount, warningCount: preview.warningCount,
          rows: preview.rows
        } });
      } catch (error) { next(error); }
    });
  app.post('/api/students/import/commit', requirePermission('students.edit'),
    express.text({ type: 'text/csv', limit: '1mb' }), async (request, response, next) => {
      try {
        const preview = await previewStudentCsv(repo, request.body, request.user);
        const imported = await repo.importStudents(preview.dataRows, request.user);
        const reportsByRow = new Map([...preview.rowReports, ...imported.reports].map((report) =>
          [report.rowNumber, report]));
        const rows = [...reportsByRow.values()].sort((left, right) => left.rowNumber - right.rowNumber);
        response.set('Cache-Control', 'no-store').json({ data: {
          totalRows: preview.totalRows, createdCount: imported.createdCount,
          skippedCount: preview.totalRows - imported.createdCount, rows,
          credentials: imported.credentials
        } });
      } catch (error) { next(error); }
    });
  app.get('/api/sections', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listSections(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/students', requirePermission('students.edit'), async (request, response, next) => {
    try {
      const result = await repo.createStudent(parse(studentSchema, request.body), request.user);
      response.set('Cache-Control', 'no-store').status(201).json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId', requirePermission('students.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const student = (await repo.listStudentsFor(request.user)).find((item) => item.id === studentId);
      if (!student) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: student });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/sensitive-data', requirePermission('students.sensitive.view'), async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const data = await repo.getStudentSensitiveData(studentId, request.user);
      if (!data) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data });
    } catch (error) { next(error); }
  });
  app.put('/api/students/:studentId/sensitive-data', requirePermission('students.sensitive.manage'), async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const data = await repo.updateStudentSensitiveData(
        studentId, parse(studentSensitiveDataSchema, request.body), request.user
      );
      if (!data) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data });
    } catch (error) { next(error); }
  });
  app.patch('/api/students/:studentId/profile', requirePermission('students.edit'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const student = await repo.updateStudentProfile(studentId, parse(studentProfileSchema, request.body), request.user);
      if (!student) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: student });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/documents', requirePermission('students.view'), async (request, response, next) => {
    try {
      const documents = await repo.listStudentDocuments(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (documents === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').json({ data: documents });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/transfer-packages', requirePermission('admissions.view'), async (request, response, next) => {
    try {
      const packages = await repo.listStudentTransferPackages(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (packages === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').json({ data: packages });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/transfer-packages', requirePermission('admissions.manage'), async (request, response, next) => {
    try {
      const result = await repo.createStudentTransferPackage(
        parse(z.string().uuid(), request.params.studentId),
        parse(studentTransferPackageSchema, request.body), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').status(201).json({ data: result });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/transfer-packages/:packageId/approve',
    requirePermission('students.transfer.approve'), async (request, response, next) => {
      try {
        const token = randomBytes(32).toString('base64url');
        const approved = await repo.approveStudentTransferPackage(
          parse(z.string().uuid(), request.params.packageId),
          createHash('sha256').update(token).digest('hex'), request.user
        );
        if (!approved) return response.status(404).json({ error: { code: 'TRANSFER_PACKAGE_NOT_FOUND', message: 'Transfer package not found.' } });
        const webOrigin = config.WEB_ORIGIN.replace(/\/+$/, '');
        response.set('Cache-Control', 'no-store').json({
          data: { ...approved, shareUrl: `${webOrigin}/transfer/${token}` }
        });
      } catch (error) { next(error); }
    });
  app.post('/api/students/:studentId/documents', requirePermission('students.edit'),
    express.raw({ type: ['application/pdf', 'image/jpeg', 'image/png'], limit: '5mb' }),
    async (request, response, next) => {
      try {
        if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
          return response.status(400).json({ error: { code: 'INVALID_DOCUMENT', message: 'Upload a non-empty PDF, JPEG, or PNG file no larger than 5 MB.' } });
        }
        const document = await repo.storeStudentDocument(
          parse(z.string().uuid(), request.params.studentId),
          parse(studentDocumentTypeSchema, request.query.type),
          parse(z.string().trim().min(1).max(180), request.query.name),
          request.headers['content-type'], request.body, request.user
        );
        response.set('Cache-Control', 'no-store').status(201).json({ data: document });
      } catch (error) { next(error); }
    });
  app.get('/api/students/:studentId/documents/:documentId', requirePermission('students.view'), async (request, response, next) => {
    try {
      const result = await repo.getStudentDocument(
        parse(z.string().uuid(), request.params.studentId),
        parse(z.string().uuid(), request.params.documentId), request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found.' } });
      response.set('Cache-Control', 'no-store').type(result.document.mimeType)
        .attachment(result.document.originalName).send(result.content);
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/emergency-contacts', requirePermission('students.emergency.view'), async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const contacts = await repo.listStudentEmergencyContacts(studentId, request.user);
      if (contacts === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: contacts });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/emergency-contacts', requirePermission('students.emergency.manage'), async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const contact = await repo.addStudentEmergencyContact(
        studentId, parse(studentEmergencyContactSchema, request.body), request.user
      );
      if (!contact) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.status(201).json({ data: contact });
    } catch (error) { next(error); }
  });
  app.delete('/api/students/:studentId/emergency-contacts/:contactId', requirePermission('students.emergency.manage'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const contactId = parse(z.string().uuid(), request.params.contactId);
      const removed = await repo.removeStudentEmergencyContact(studentId, contactId, request.user);
      if (!removed) return response.status(404).json({ error: { code: 'EMERGENCY_CONTACT_NOT_FOUND', message: 'Emergency contact not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/guardians', requirePermission('students.guardians.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardians = await repo.listStudentGuardians(studentId, request.user);
      if (guardians === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: guardians });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/guardians', requirePermission('students.guardians.manage'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardian = await repo.addStudentGuardian(studentId, parse(studentGuardianSchema, request.body), request.user);
      response.status(201).json({ data: guardian });
    } catch (error) { next(error); }
  });
  app.patch('/api/students/:studentId/guardians/:guardianId/access', requirePermission('students.guardians.manage'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardianId = parse(z.string().uuid(), request.params.guardianId);
      const access = parse(guardianAccessSchema, request.body);
      const updated = await repo.verifyStudentGuardian(studentId, guardianId, access, request.user);
      if (!updated) return response.status(404).json({ error: { code: 'GUARDIAN_LINK_NOT_FOUND', message: 'Guardian link not found.' } });
      response.json({ data: updated });
    } catch (error) { next(error); }
  });
  app.delete('/api/students/:studentId/guardians/:guardianId', requirePermission('students.guardians.manage'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const guardianId = parse(z.string().uuid(), request.params.guardianId);
      const removed = await repo.removeStudentGuardian(studentId, guardianId, request.user);
      if (!removed) return response.status(404).json({ error: { code: 'GUARDIAN_LINK_NOT_FOUND', message: 'Guardian link not found.' } });
      response.status(204).end();
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/discipline', requirePermission('students.discipline.view'), async (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const records = await repo.listStudentDisciplineRecords(
        parse(z.string().uuid(), request.params.studentId), request.user
      );
      if (records === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: records });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/discipline', requirePermission('students.discipline.manage'), async (request, response, next) => {
    try {
      const record = await repo.createStudentDisciplineRecord(
        parse(z.string().uuid(), request.params.studentId),
        parse(disciplineRecordSchema, request.body), request.user
      );
      if (!record) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.set('Cache-Control', 'no-store').status(201).json({ data: record });
    } catch (error) { next(error); }
  });
  app.get('/api/students/:studentId/commendations', requirePermission('students.commendations.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const commendations = await repo.listStudentCommendations(studentId, request.user);
      if (commendations === null) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.json({ data: commendations });
    } catch (error) { next(error); }
  });
  app.post('/api/students/:studentId/commendations', requirePermission('students.commendations.manage'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const commendation = await repo.createStudentCommendation(
        studentId, parse(studentCommendationSchema, request.body), request.user
      );
      if (!commendation) return response.status(404).json({ error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found.' } });
      response.status(201).json({ data: commendation });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listAttendance(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance/summary', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      const range = parse(feeReportRangeSchema, {
        from: request.query.from,
        to: request.query.to
      });
      response.json({ data: await repo.getAttendanceSummary(
        request.user.activeCampusId, range.from, range.to, request.user
      ) });
    } catch (error) { next(error); }
  });
  app.post('/api/attendance', requirePermission('attendance.take'), async (request, response, next) => {
    try {
      const item = await repo.saveAttendance(parse(attendanceSchema, request.body), request.user);
      response.status(item.duplicate ? 200 : 201).json({ data: item });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance/sessions/:sessionId', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      const sessionId = parse(z.string().uuid(), request.params.sessionId);
      const session = await repo.getAttendanceSession(sessionId, request.user);
      if (!session) return response.status(404).json({ error: { code: 'ATTENDANCE_SESSION_NOT_FOUND', message: 'Attendance session not found.' } });
      response.json({ data: session });
    } catch (error) { next(error); }
  });
  app.patch('/api/attendance/sessions/:sessionId/records/:studentId', requirePermission('attendance.edit'), async (request, response, next) => {
    try {
      const sessionId = parse(z.string().uuid(), request.params.sessionId);
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const correction = parse(attendanceCorrectionSchema, request.body);
      const result = await repo.correctAttendance(sessionId, studentId, correction, request.user);
      if (!result) return response.status(404).json({ error: { code: 'ATTENDANCE_RECORD_NOT_FOUND', message: 'Attendance record not found.' } });
      if (result.approvalRequired) return response.status(202).json({ data: result });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance/correction-requests', requirePermission('attendance.corrections.review'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listAttendanceCorrectionRequests(request.user) });
    } catch (error) { next(error); }
  });
  app.patch('/api/attendance/correction-requests/:requestId', requirePermission('attendance.corrections.review'), async (request, response, next) => {
    try {
      const result = await repo.reviewAttendanceCorrection(
        parse(z.string().uuid(), request.params.requestId),
        parse(attendanceCorrectionReviewSchema, request.body),
        request.user
      );
      if (!result) return response.status(404).json({ error: { code: 'ATTENDANCE_CORRECTION_REQUEST_NOT_FOUND', message: 'Pending correction request not found.' } });
      response.json({ data: result });
    } catch (error) { next(error); }
  });
  app.get('/api/attendance/sections/:sectionId/roster', requirePermission('attendance.view'), async (request, response, next) => {
    try {
      const sectionId = parse(z.string().uuid(), request.params.sectionId);
      const students = await repo.listRoster(request.user, sectionId);
      response.json({ data: students });
    } catch (error) { next(error); }
  });
  app.get('/api/marks', requirePermission('marks.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listMarks(request.user.activeCampusId, request.user) });
    } catch (error) { next(error); }
  });
  app.get('/api/marks/context', requirePermission('marks.view'), async (request, response, next) => {
    try {
      const campusId = request.user.activeCampusId;
      response.json({ data: {
        terms: await repo.listTerms(campusId),
        subjects: await repo.listSubjects(campusId)
      } });
    } catch (error) { next(error); }
  });
  app.get('/api/marks/summary', requirePermission('marks.view'), async (request, response, next) => {
    try {
      const termId = parse(z.string().uuid(), request.query.termId);
      response.json({ data: await repo.getTermMarksSummary(termId, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/marks', requirePermission('marks.enter'), async (request, response, next) => {
    try {
      const input = parse(markSchema, request.body);
      const item = await repo.saveMark(input, request.user);
      response.status(item.duplicate ? 200 : 201).json({ data: item });
    } catch (error) { next(error); }
  });
  app.post('/api/marks/:markId/submit', requirePermission('marks.enter'), async (request, response, next) => {
    try {
      const item = await repo.transitionMark(
        parse(z.string().uuid(), request.params.markId), 'submitted', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.post('/api/marks/:markId/approve', requirePermission('marks.approve'), async (request, response, next) => {
    try {
      const item = await repo.transitionMark(
        parse(z.string().uuid(), request.params.markId), 'approved', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.post('/api/marks/:markId/publish', requirePermission('marks.publish'), async (request, response, next) => {
    try {
      const item = await repo.transitionMark(
        parse(z.string().uuid(), request.params.markId), 'locked', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.post('/api/marks/:markId/amend', requirePermission('marks.amend'), async (request, response, next) => {
    try {
      const item = await repo.amendPublishedMark(
        parse(z.string().uuid(), request.params.markId),
        parse(markAmendmentSchema, request.body),
        request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'MARK_NOT_FOUND', message: 'Mark not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.get('/api/marks/students/:studentId', requirePermission('marks.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const marks = await repo.listMarks(request.user.activeCampusId, request.user);
      response.json({ data: marks.filter((item) => item.studentId === studentId) });
    } catch (error) { next(error); }
  });
  app.get('/api/grading/bands', requirePermission('marks.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.listGradingBands(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.put('/api/grading/bands', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const bands = await repo.replaceGradingBands(parse(gradingScaleSchema, request.body), request.user);
      response.json({ data: bands });
    } catch (error) { next(error); }
  });
  app.get('/api/grading/policy', requirePermission('marks.view'), async (request, response, next) => {
    try {
      response.json({ data: await repo.getGradingPolicy(request.user.activeCampusId) });
    } catch (error) { next(error); }
  });
  app.put('/api/grading/policy', requirePermission('school.edit'), async (request, response, next) => {
    try {
      const policy = await repo.confirmGradingPolicy(
        parse(gradingPolicySchema, request.body), request.user
      );
      response.json({ data: policy });
    } catch (error) { next(error); }
  });
  app.get('/api/report-cards/students/:studentId', requirePermission('marks.view'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const termId = parse(z.string().uuid(), request.query.termId);
      response.json({ data: await repo.getStudentReportCard(studentId, termId, request.user) });
    } catch (error) { next(error); }
  });
  app.post('/api/report-cards/students/:studentId/drafts', requirePermission('marks.approve'), async (request, response, next) => {
    try {
      const studentId = parse(z.string().uuid(), request.params.studentId);
      const input = parse(z.object({
        termId: z.string().uuid(),
        amendmentReason: z.string().trim().min(5).max(500).optional()
      }), request.body);
      response.status(201).json({
        data: await repo.createTermReportDraft(
          studentId, input.termId, request.user, input.amendmentReason ?? null
        )
      });
    } catch (error) { next(error); }
  });
  app.post('/api/report-cards/:reportId/submit', requirePermission('marks.approve'), async (request, response, next) => {
    try {
      const item = await repo.transitionTermReport(
        parse(z.string().uuid(), request.params.reportId), 'submitted', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'Report revision not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.post('/api/report-cards/:reportId/approve', requirePermission('marks.approve'), async (request, response, next) => {
    try {
      const item = await repo.transitionTermReport(
        parse(z.string().uuid(), request.params.reportId), 'approved', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'Report revision not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });
  app.post('/api/report-cards/:reportId/publish', requirePermission('marks.publish'), async (request, response, next) => {
    try {
      const item = await repo.transitionTermReport(
        parse(z.string().uuid(), request.params.reportId), 'published', request.user
      );
      if (!item) return response.status(404).json({ error: { code: 'REPORT_NOT_FOUND', message: 'Report revision not found.' } });
      response.json({ data: item });
    } catch (error) { next(error); }
  });

  app.use((request, response) => response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'API route not found.' }
  }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status ?? (['STUDENT_NO_CONFLICT', 'ACADEMIC_YEAR_CONFLICT', 'SETUP_CONFLICT', 'SCHEDULE_CONFLICT', 'FEE_CONFLICT'].includes(error.code) ? 409 :
      error.code === 'CAMPUS_SCOPE_VIOLATION' ? 403 : 500);
    if (status >= 500) {
      logger.error({ err: error, requestId: response.getHeader('X-Request-Id'), path: request.path }, 'Request failed');
    }
    const code = error.code ?? 'INTERNAL_ERROR';
    const message = status >= 500 ? 'An unexpected error occurred.' : error.message;
    response.status(status).json({
      error: { code, message, ...(error.details ? { details: error.details } : {}) }
    });
  });
  return app;
}

function authenticate(config, repo) {
  return async (request, response, next) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
    let claims;
    try {
      claims = verifyAccessToken(token, config);
    } catch {
      return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Access token expired or invalid.' } });
    }
    if (!claims.sub || !claims.orgId) {
      return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid access token.' } });
    }
    try {
      const currentUser = await repo.findUserById(claims.sub);
      if (currentUser?.accountActive === false) {
        return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Your account is inactive. Contact your school administrator.' } });
      }
      if (currentUser && claims.authVersion !== undefined &&
          Number(claims.authVersion) !== Number(currentUser.authVersion ?? 0)) {
        return response.status(401).json({ error: { code: 'SESSION_REVOKED', message: 'This session is no longer valid. Sign in again.' } });
      }
      if (!currentUser) {
        request.user = claims;
      } else {
        const activeCampusId = currentUser.role === 'super_admin'
          ? null
          : currentUser.campusIds.includes(claims.activeCampusId)
            ? claims.activeCampusId : currentUser.activeCampusId;
        if (currentUser.role !== 'super_admin' &&
            (!activeCampusId || !currentUser.campusIds.includes(activeCampusId))) {
          return response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid access token.' } });
        }
        request.user = {
          ...claims, orgId: currentUser.orgId, role: currentUser.role,
          name: currentUser.name, email: currentUser.email,
          campusIds: currentUser.campusIds, activeCampusId
        };
      }
    } catch (error) { return next(error); }
    if (request.user.role === 'super_admin') return next();
    if (request.user.role !== 'super_admin') {
      try {
        if (!await repo.isOrganizationOperational(request.user.orgId)) {
          return response.status(403).json({
            error: { code: 'SCHOOL_INACTIVE', message: 'School access is suspended or closed. Contact the platform team.' }
          });
        }
      } catch (error) { return next(error); }
    }
    next();
  };
}

function requirePermission(permission) {
  return (request, response, next) => {
    const roles = permissionRoles[permission] ?? [];
    if (!roles.includes(request.user.role)) {
      return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    }
    if (request.user.role === 'super_admin' && ['platform.view', 'platform.manage'].includes(permission)) {
      return next();
    }
    const campusIds = Array.isArray(request.user.campusIds) ? request.user.campusIds : [];
    if (!campusIds.includes(request.user.activeCampusId)) {
      return response.status(403).json({ error: { code: 'CAMPUS_SCOPE_DENIED', message: 'Campus access is not granted.' } });
    }
    next();
  };
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toCsv(rows) {
  return rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function printableDocument(title, content) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@page{size:A4;margin:22mm}body{font-family:"Noto Sans Ethiopic",Arial,sans-serif;color:#17212b;line-height:1.6}h1{text-align:center}.actions{margin:1rem 0}@media print{.actions{display:none}}</style>
<body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><main>${content}</main></body></html>`;
}

function offerLetterHtml(admission) {
  const nameEn = [admission.givenNameEn, admission.fatherNameEn, admission.grandfatherNameEn].join(' ');
  const nameAm = [admission.givenNameAm, admission.fatherNameAm, admission.grandfatherNameAm].join(' ');
  return printableDocument('Admission offer letter', `
    <h1>Admission Offer / የመግቢያ የቅበላ ደብዳቤ</h1>
    <p>Date / ቀን: ${new Date().toISOString().slice(0, 10)}</p>
    <p>Dear ${escapeHtml(admission.guardianName)}, / ውድ ${escapeHtml(admission.guardianName)},</p>
    <p>We are pleased to offer ${escapeHtml(nameEn)} (${escapeHtml(nameAm)}) admission to ${escapeHtml(admission.gradeName)}.</p>
    <p>ተማሪ ${escapeHtml(nameAm)} (${escapeHtml(nameEn)}), በ${escapeHtml(admission.gradeName)} እንዲማር ተቀብለናል።</p>
    <p>Please contact the registrar to complete enrolment and submit the remaining required documents.</p>
    <p>Registrar / ሬጅስትራር: ____________________</p>`);
}

function transferCertificateHtml(record) {
  const student = record.student;
  const nameEn = [student.givenNameEn, student.fatherNameEn, student.grandfatherNameEn].join(' ');
  const nameAm = [student.givenNameAm, student.fatherNameAm, student.grandfatherNameAm].join(' ');
  return printableDocument('Student transfer certificate', `
    <h1>Transfer Certificate / የዝውውር ማስረጃ</h1>
    <p>${escapeHtml(record.campus.name)} · ${escapeHtml(record.campus.address)}</p>
    <p>Student ID / የተማሪ መለያ: ${escapeHtml(student.studentNo)}</p>
    <p>Name / ስም: ${escapeHtml(nameEn)} / ${escapeHtml(nameAm)}</p>
    <p>Transfer date / የዝውውር ቀን: ${escapeHtml(String(record.history.createdAt).slice(0, 10))}</p>
    <p>Reason / ምክንያት: ${escapeHtml(record.history.reason)}</p>
    <p>Principal signature / የርዕሰ መምህር ፊርማ: ____________________</p>`);
}
