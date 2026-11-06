import { z } from 'zod';

const permissionKeys = z.array(z.string().trim().min(1).max(100)).max(200)
  .transform((keys) => [...new Set(keys)]);

export const roleCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  permissions: permissionKeys
});

export const rolePermissionsSchema = z.object({ permissions: permissionKeys });
export const roleAssignmentSchema = z.object({ role: z.string().trim().min(1).max(40) });
export const platformInvitationSchema = z.object({
  name: z.string().trim().min(2).max(180),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(['super_admin', 'support_staff']).default('super_admin')
});
export const platformUserUpdateSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional()
}).refine((value) => Object.keys(value).length > 0);
export const platformUserStatusSchema = z.object({ isActive: z.boolean() });
