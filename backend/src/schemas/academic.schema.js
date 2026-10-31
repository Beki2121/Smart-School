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
export const gradeSubjectsSchema = z.object({
  subjects: z.array(z.object({
    subjectId: z.string().uuid(),
    stream: z.enum(['all', 'natural_science', 'social_science']).default('all'),
    weeklyPeriods: z.number().int().min(1).max(60),
    isRequired: z.boolean().default(true)
  })).max(100)
});
export const subjectSchema = z.object({
  code: z.string().trim().min(1).max(24),
  nameEn: z.string().trim().min(1).max(100),
  nameAm: z.string().trim().min(1).max(100),
  category: z.enum(['core', 'language', 'mathematics', 'science', 'social_science', 'arts', 'health', 'technology', 'other']).default('core')
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
export const curriculumUnitSchema = z.object({
  academicYearId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  subjectId: z.string().uuid(),
  stream: z.enum(['all', 'natural_science', 'social_science']).default('all'),
  unitNumber: z.number().int().min(1).max(200),
  titleEn: z.string().trim().min(2).max(160),
  titleAm: z.string().trim().min(2).max(160),
  learningOutcomesEn: z.string().trim().min(3).max(5000),
  learningOutcomesAm: z.string().trim().min(3).max(5000),
  plannedStart: z.string().date().nullable().optional(),
  plannedEnd: z.string().date().nullable().optional()
}).refine((unit) => !unit.plannedStart || !unit.plannedEnd || unit.plannedStart <= unit.plannedEnd, {
  message: 'Unit end date cannot be before its start date.',
  path: ['plannedEnd']
});
export const lessonPlanSchema = z.object({
  teachingAssignmentId: z.string().uuid(),
  curriculumUnitId: z.string().uuid().nullable().optional(),
  plannedOn: z.string().date(),
  titleEn: z.string().trim().min(2).max(160),
  titleAm: z.string().trim().min(2).max(160),
  objectivesEn: z.string().trim().min(3).max(5000),
  objectivesAm: z.string().trim().min(3).max(5000),
  activitiesEn: z.string().trim().min(3).max(5000),
  activitiesAm: z.string().trim().min(3).max(5000),
  resources: z.string().trim().max(2000).optional().default('')
});
export const lessonPlanUpdateSchema = z.object({
  titleEn: z.string().trim().min(2).max(160).optional(),
  titleAm: z.string().trim().min(2).max(160).optional(),
  objectivesEn: z.string().trim().min(3).max(5000).optional(),
  objectivesAm: z.string().trim().min(3).max(5000).optional(),
  activitiesEn: z.string().trim().min(3).max(5000).optional(),
  activitiesAm: z.string().trim().min(3).max(5000).optional(),
  resources: z.string().trim().max(2000).optional(),
  status: z.enum(['planned', 'completed', 'cancelled']).optional()
}).refine((plan) => Object.keys(plan).length > 0, {
  message: 'Provide at least one lesson plan field to update.'
});
export const promotionRuleSchema = z.object({
  gradeLevelId: z.string().uuid(),
  minimumAnnualPercent: z.number().min(0).max(100),
  maximumFailedRequiredSubjects: z.number().int().min(0).max(12)
});
