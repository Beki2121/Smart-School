import { z } from 'zod';

export const subscriptionPlanSchema = z.object({
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).default(''),
  monthlyPrice: z.number().finite().min(0).max(999999999),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  trialDays: z.number().int().min(0).max(365),
  studentLimit: z.number().int().positive().nullable(),
  staffLimit: z.number().int().positive().nullable(),
  siteLimit: z.number().int().positive().nullable(),
  billingCycle: z.enum(['monthly', 'termly', 'yearly']).default('monthly'),
  maxUsers: z.number().int().positive().max(2147483647).nullable().optional(),
  storageLimitBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  modules: z.array(z.string().trim().min(2).max(60)).max(40),
  isActive: z.boolean()
});

export const subscriptionInvoiceSchema = z.object({
  amount: z.number().finite().positive().max(999999999),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  dueOn: z.string().date().nullable().optional()
});

export const subscriptionAssignmentSchema = z.object({
  planCode: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/)
});

export const subscriptionPaymentSchema = z.object({
  amount: z.number().finite().positive().max(999999999),
  reference: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  receivedOn: z.string().date()
});

export const subscriptionRefundSchema = z.object({
  amount: z.number().finite().positive().max(999999999),
  reason: z.string().trim().min(3).max(500)
});

export const outstandingReportDateRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional()
}).refine(({ from, to }) => !from || !to || from <= to, {
  path: ['to'],
  message: 'The end date must be on or after the start date.'
});

export const platformSettingsSchema = z.object({
  defaultLocale: z.enum(['en', 'am']),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']),
  calendarType: z.enum(['ethiopian', 'gregorian']),
  smtpHost: z.string().trim().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(254).optional(),
  smtpPassword: z.string().max(4096).optional(),
  smtpFrom: z.string().trim().email().max(254).optional()
});

export const organizationStatusSchema = z.object({
  status: z.enum(['active', 'suspended'])
});

export const platformSchoolCreateSchema = z.object({
  schoolName: z.string().trim().min(2).max(180),
  ownerName: z.string().trim().min(2).max(180),
  ownerEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  schoolPhone: z.string().trim().max(32).optional().default(''),
  address: z.string().trim().max(500).optional().default(''),
  locale: z.enum(['en', 'am']).default('en'),
  currencyCode: z.enum(['ETB', 'USD']).default('ETB'),
  timezone: z.string().trim().min(3).max(64).default('Africa/Addis_Ababa'),
  academicConfiguration: z.object({
    calendarType: z.enum(['ethiopian', 'gregorian']).default('ethiopian'),
    dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd']).default('dd/MM/yyyy'),
    defaultLocale: z.enum(['en', 'am']).default('en')
  }).default({})
});

export const organizationBranchCreateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  address: z.string().trim().max(500).optional().default(''),
  phone: z.string().trim().max(32).optional().default('')
});

export const organizationBranchUpdateSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0);

export const switchBranchSchema = z.object({
  campusId: z.string().uuid()
});

export const closureApprovalSchema = z.object({
  retentionDays: z.number().int().min(30).max(3650),
  financialRetentionDays: z.number().int().min(30).max(36500)
});

export const closurePseudonymizationSchema = z.object({
  confirmation: z.literal('PSEUDONYMIZE')
});
