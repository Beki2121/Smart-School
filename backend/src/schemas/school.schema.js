import { z } from 'zod';

export const organizationSettingsSchema = z.object({
  preferredLocale: z.enum(['en', 'am']),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  branding: z.object({
    logoUrl: z.union([z.literal(''), z.string().url().max(1000)]),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/)
  })
});
export const closureRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1000)
});
export const schoolProfileSchema = z.object({
  name: z.string().trim().min(2).max(180),
  address: z.string().trim().max(500).optional().default(''),
  phone: z.string().trim().max(32).optional().default('')
});
