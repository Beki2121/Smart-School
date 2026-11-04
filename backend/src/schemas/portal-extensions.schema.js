import { z } from 'zod';

const uuid = z.string().uuid();

export const portalCalendarQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).refine(({ from, to }) => from <= to, {
  message: 'Start date must not be after end date.', path: ['from']
});

export const portalRequestSchema = z.object({
  studentId: uuid,
  type: z.enum(['absence_explanation', 'document_request', 'profile_update']),
  subject: z.string().trim().min(2).max(180),
  details: z.string().trim().min(5).max(4000)
});

export const portalRequestDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'completed']),
  response: z.string().trim().max(2000).optional().default('')
});

export const portalSupportRequestSchema = z.object({
  studentId: uuid.optional(),
  category: z.enum(['academic', 'technical']),
  subject: z.string().trim().min(2).max(180),
  details: z.string().trim().min(5).max(4000)
});

export const portalSupportDecisionSchema = z.object({
  status: z.enum(['in_progress', 'resolved', 'closed']),
  response: z.string().trim().max(2000).optional().default('')
});

export const portalMessageSchema = z.object({
  studentId: uuid,
  recipientId: uuid.optional(),
  body: z.string().trim().min(1).max(4000)
});

export const portalThreadMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000)
});

export const portalModerationSchema = z.object({
  status: z.enum(['visible', 'archived']),
  reason: z.string().trim().min(3).max(500)
});

export const portalMessagingSettingSchema = z.object({
  messagingEnabled: z.boolean()
});

export const campusEventStatusSchema = z.object({
  status: z.enum(['cancelled', 'archived', 'published'])
});
