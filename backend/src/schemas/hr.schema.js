import { z } from 'zod';

const uuid = z.string().uuid();

export const hrStaffUpdateSchema = z.object({
  departmentId: uuid.nullable().optional(),
  givenNameEn: z.string().trim().min(1).max(100).optional(),
  fatherNameEn: z.string().trim().min(1).max(100).optional(),
  grandfatherNameEn: z.string().trim().min(1).max(100).optional(),
  givenNameAm: z.string().trim().min(1).max(100).optional(),
  fatherNameAm: z.string().trim().min(1).max(100).optional(),
  grandfatherNameAm: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().trim().min(1).max(120).optional(),
  qualification: z.string().trim().max(255).optional(),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).optional(),
  hiredOn: z.string().date().nullable().optional()
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const hrStaffIdSchema = uuid;
export const hrDocumentCategorySchema = z.enum([
  'identity', 'qualification', 'employment', 'contract', 'certificate', 'other'
]);
export const hrDocumentNameSchema = z.string().trim().min(1).max(180);

export const hrStaffImportSchema = z.object({
  departmentId: uuid.nullable().optional(),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().min(1).max(120),
  qualification: z.string().trim().max(255).optional().default(''),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).optional().default('active'),
  hiredOn: z.string().date().nullable().optional()
});

export const hrDateRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).refine((range) => range.from <= range.to, {
  message: 'End date must be on or after start date.',
  path: ['to']
});

export const hrContractSchema = z.object({
  contractType: z.enum(['permanent', 'fixed_term', 'probation', 'temporary', 'consultant']),
  startsOn: z.string().date(),
  endsOn: z.string().date().nullable().optional(),
  renewalDueOn: z.string().date().nullable().optional(),
  notes: z.string().trim().max(4000).optional().default('')
}).refine((value) => !value.endsOn || value.endsOn >= value.startsOn, {
  message: 'Contract end date must be on or after start date.',
  path: ['endsOn']
});

export const hrContractRenewalSchema = z.object({
  newEndDate: z.string().date()
});

export const hrLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['annual', 'sick', 'unpaid']),
  annualEntitlementHalfDays: z.number().int().min(0).max(730).default(0),
  carryOverLimitHalfDays: z.number().int().min(0).max(730).default(0),
  isActive: z.boolean().default(true)
});

export const hrLeaveBalanceSchema = z.object({
  staffId: uuid,
  leaveTypeId: uuid,
  year: z.number().int().min(2000).max(2200),
  entitledHalfDays: z.number().int().min(0).max(730).optional(),
  carryOverHalfDays: z.number().int().min(0).max(730)
});

export const hrRenewalIdSchema = uuid;
export const hrLeaveTypeIdSchema = uuid;
export const hrContractListSchema = z.object({
  staffId: uuid.optional()
});
export const hrLeaveBalanceListSchema = z.object({
  staffId: uuid.optional(),
  year: z.coerce.number().int().min(2000).max(2200).optional()
});
export const hrApprovedLeavePeriodSchema = hrDateRangeSchema.extend({
  staffId: uuid
});

export const hrVacancySchema = z.object({
  departmentId: uuid.nullable().optional(),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(8000).default('')
});
export const hrApplicantSchema = z.object({
  givenName: z.string().trim().min(1).max(100),
  fatherName: z.string().trim().min(1).max(100),
  grandfatherName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLocaleLowerCase()),
  phone: z.string().trim().min(3).max(40)
});
export const hrInterviewSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(4000).default('')
});
export const hrApplicantDecisionSchema = z.object({
  decision: z.enum(['shortlisted', 'rejected', 'hired']),
  reason: z.string().trim().min(1).max(1000)
});
export const hrPerformanceCycleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startsOn: z.string().date(),
  endsOn: z.string().date()
}).refine((value) => value.endsOn >= value.startsOn, {
  message: 'Cycle end must be on or after its start.',
  path: ['endsOn']
});
export const hrPerformanceGoalSchema = z.object({
  staffId: uuid,
  cycleId: uuid,
  title: z.string().trim().min(2).max(180),
  details: z.string().trim().max(4000).default('')
});
export const hrPerformanceEvaluationSchema = z.object({
  staffId: uuid,
  cycleId: uuid,
  rating: z.number().int().min(1).max(5),
  feedback: z.string().trim().min(1).max(8000)
});
export const hrTrainingCourseSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(8000).default(''),
  startsOn: z.string().date(),
  endsOn: z.string().date()
}).refine((value) => value.endsOn >= value.startsOn, {
  message: 'Course end must be on or after its start.',
  path: ['endsOn']
});
export const hrTrainingEnrollmentSchema = z.object({
  staffId: uuid
});
export const hrTrainingAttendanceSchema = z.object({
  status: z.enum(['enrolled', 'attended', 'absent'])
});
export const hrApplicantDocumentCategorySchema = z.enum([
  'identity', 'qualification', 'resume', 'certificate', 'other'
]);
