import { z } from 'zod';

export const loginSchema = z.object({
  login: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(128)
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase())
});

export const passwordResetSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128),
  confirmPassword: z.string().min(12).max(128)
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'], message: 'Passwords do not match.'
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(12).max(128)
});

export const invitationAcceptanceSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128)
});
