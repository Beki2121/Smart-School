import { z } from 'zod';

export const schoolRegistrationSchema = z.object({
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
