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

export const organizationStatusSchema = z.object({
  status: z.enum(['active', 'suspended'])
});

export const closureApprovalSchema = z.object({
  retentionDays: z.number().int().min(30).max(3650),
  financialRetentionDays: z.number().int().min(30).max(36500)
});

export const closurePseudonymizationSchema = z.object({
  confirmation: z.literal('PSEUDONYMIZE')
});
