import { z } from 'zod';

export const academicYearSchema = z.object({
  labelEc: z.string().trim().min(4).max(24),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((year) => year.startDate < year.endDate, {
  message: 'Academic year end must be after its start.',
  path: ['endDate']
});
export const academicYearIdSchema = z.string().uuid();
export const termSchema = z.object({
  name: z.string().trim().min(1).max(80),
  periodType: z.enum(['term', 'semester']).default('term'),
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine((term) => term.startDate < term.endDate, {
  message: 'Term end must be after its start.',
  path: ['endDate']
});
export const gradeSchema = z.object({
  code: z.string().trim().min(1).max(24)
});
export const sectionSchema = z.object({
  gradeLevelId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  capacity: z.number().int().positive().max(1000).nullable().optional(),
  shift: z.enum(['morning', 'afternoon', 'evening']).default('morning'),
  stream: z.enum(['natural_science', 'social_science']).optional()
});
export const sectionCapacitySchema = z.object({
  capacity: z.number().int().positive().max(1000).nullable()
});
export const schoolCalendarEntrySchema = z.object({
  academicYearId: z.string().uuid().nullable().optional(),
  entryType: z.enum(['holiday', 'event', 'exam', 'closure']),
  titleEn: z.string().trim().min(2).max(160),
  titleAm: z.string().trim().min(2).max(160),
  startDate: z.string().date(),
  endDate: z.string().date(),
  isNonInstructionalDay: z.boolean().default(false),
  notesEn: z.string().trim().max(500).optional().default(''),
  notesAm: z.string().trim().max(500).optional().default('')
}).refine((entry) => entry.startDate <= entry.endDate, {
  message: 'Calendar entry end date cannot be before its start date.',
  path: ['endDate']
});
