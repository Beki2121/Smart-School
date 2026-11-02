import { z } from 'zod';

const dateFilter = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const auditQuerySchema = z.object({
  from: dateFilter,
  to: dateFilter,
  userId: z.string().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().trim().max(36).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).refine((value) => !value.from || !value.to || value.from <= value.to, {
  path: ['to'], message: 'End date must be on or after the start date.'
});

export const auditExportQuerySchema = auditQuerySchema.safeExtend({
  pageSize: z.coerce.number().int().min(1).max(10000).default(10000)
});

export const sessionIdSchema = z.string().uuid();
