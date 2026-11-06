import { z } from 'zod';

const id = z.string().uuid();
const supportStatuses = ['open', 'assigned', 'in_progress', 'waiting_on_school', 'resolved', 'closed'];

export const supportListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(supportStatuses).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
export const supportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(180),
  category: z.enum(['technical', 'account', 'billing', 'security', 'other']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal')
}).strict();
export const supportTicketUpdateSchema = z.object({
  status: z.enum(supportStatuses).optional(),
  assignedTo: id.nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one ticket field must be updated.'
});
export const supportCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  isInternal: z.boolean().default(false)
}).strict();
export const supportAttachmentSchema = z.object({
  originalName: z.string().trim().min(1).max(180),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'text/plain'])
}).strict();
export const integrationTestEmailSchema = z.object({
}).strict();
export const emailVerificationTokenSchema = z.object({
  token: z.string().trim().min(32).max(128)
}).strict();
