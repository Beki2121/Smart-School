import { z } from 'zod';

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional().default('')
});
export const staffSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().min(1).max(120),
  qualification: z.string().trim().max(255).optional().default(''),
  employmentStatus: z.enum(['active', 'on_leave', 'terminated']).default('active'),
  hiredOn: z.string().date().nullable().optional()
});
export const staffDateSchema = z.object({
  staffId: z.string().uuid().optional(),
  date: z.string().date(),
  status: z.enum(['present', 'absent', 'late', 'excused']),
  clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional()
});
export const leaveSchema = z.object({
  staffId: z.string().uuid().optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  reason: z.string().trim().min(3).max(1000)
}).refine((leave) => leave.startDate <= leave.endDate, {
  message: 'Leave end date must be on or after the start date.',
  path: ['endDate']
});
export const leaveReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional().default('')
});
export const staffMessageSchema = z.object({
  departmentId: z.string().uuid().nullable().optional(),
  type: z.enum(['handover', 'announcement']),
  title: z.string().trim().min(2).max(180),
  body: z.string().trim().min(1).max(10000)
});
