import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportQuerySchema = z.object({
  year: z.string().uuid().optional(),
  term: z.string().uuid().optional(),
  grade: z.string().uuid().optional(),
  section: z.string().uuid().optional(),
  from: date.optional(),
  to: date.optional(),
  workloadLimit: z.coerce.number().int().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
}).strict();

export const reportIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
