import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max).default('');
const id = z.string().uuid();
const dateTime = z.string().datetime({ local: true });

export const frontDeskIdSchema = id;
export const frontDeskListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  studentId: id.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
}).strict();
export const frontDeskVisitorSchema = z.object({
  visitorName: text(180), purpose: text(500), hostStaffId: id.nullable().optional()
}).strict();
export const frontDeskAppointmentSchema = z.object({
  parentName: text(180), studentId: id.nullable().optional(), staffId: id,
  appointmentAt: dateTime, purpose: text(500)
}).strict();
export const frontDeskAppointmentStatusSchema = z.object({
  status: z.enum(['confirmed', 'completed', 'cancelled'])
}).strict();
export const frontDeskMessageSchema = z.object({
  senderName: text(180), recipientStaffId: id, subject: text(180), message: text(2000)
}).strict();
export const frontDeskMessageStatusSchema = z.object({
  status: z.enum(['read', 'resolved'])
}).strict();
export const frontDeskAuthorizationSchema = z.object({
  studentId: id, guardianName: text(180), relationship: text(80),
  phone: optionalText(40), authorizationType: z.enum(['regular', 'temporary']).default('regular'),
  oneTime: z.boolean().default(false), expiresAt: dateTime.nullable().default(null)
}).strict().refine((value) => value.authorizationType !== 'temporary' || value.expiresAt !== null,
  { message: 'Temporary authorizations require an expiry date.', path: ['expiresAt'] })
  .refine((value) => !value.oneTime || value.authorizationType === 'temporary', {
    message: 'One-time authorizations must be temporary.', path: ['authorizationType']
  });
export const frontDeskAuthorizationStatusSchema = z.object({
  status: z.enum(['active', 'removed', 'expired'])
}).strict();
export const frontDeskPickupReleaseSchema = z.object({
  studentId: id, personName: text(180), authorizationId: id,
  occasionKey: z.string().trim().min(8).max(100),
  verificationNote: optionalText(200), confirmOneTime: z.boolean().default(false)
}).strict();
export const frontDeskPickupCorrectionSchema = z.object({
  reason: text(500), note: optionalText(200)
}).strict();
export const frontDeskDeliverySchema = z.object({
  recipientName: text(180), recipientStaffId: id.nullable().optional(),
  description: text(500)
}).strict();
export const frontDeskDeliveryStatusSchema = z.object({
  status: z.enum(['collected', 'returned'])
}).strict();
export const frontDeskLostFoundSchema = z.object({
  description: text(500), locationFound: text(180), foundAt: dateTime
}).strict();
export const frontDeskLostFoundStatusSchema = z.object({
  status: z.enum(['claimed', 'disposed']), claimedBy: text(180).nullable().optional()
}).strict().refine((value) => value.status !== 'claimed' || Boolean(value.claimedBy), {
  message: 'A claimant name is required when claiming an item.', path: ['claimedBy']
});
export const frontDeskSettingsSchema = z.object({
  blockAbsentPickup: z.boolean(), blockReleasedToday: z.boolean(),
  securityRoleKey: z.string().trim().max(80).nullable()
}).strict();
