import { z } from 'zod';

export const timetablePeriodSchema = z.object({
  shift: z.enum(['morning', 'afternoon', 'evening']),
  periodNumber: z.number().int().min(1).max(20),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/)
}).refine((period) => period.startsAt < period.endsAt, {
  message: 'Period end time must be after its start time.',
  path: ['endsAt']
});
export const roomSchema = z.object({
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().positive().max(1000).nullable().optional()
});
export const timetableQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  date: z.string().date().optional()
});
export const substituteSchema = z.object({
  substituteStaffId: z.string().uuid(),
  date: z.string().date(),
  leaveRequestId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500)
});
export const assignmentSchema = z.object({
  staffId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  roomId: z.string().uuid().nullable().optional(),
  dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
  periodNumber: z.number().int().min(1).max(20).nullable().optional()
}).refine((assignment) =>
  (assignment.dayOfWeek == null) === (assignment.periodNumber == null), {
  message: 'Set both timetable day and period, or leave both unset.',
  path: ['periodNumber']
});
