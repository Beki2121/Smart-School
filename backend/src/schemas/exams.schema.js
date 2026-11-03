import { z } from 'zod';

const weightPercent = z.number().min(0).max(100).refine(
  (value) => Number.isInteger(value * 100),
  { message: 'Exam weights support at most two decimal places.' }
);
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const examTypeSchema = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(100),
  weightPercent
});

export const examTypeUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  weightPercent: weightPercent.optional(),
  isActive: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0);

export const examScheduleEntrySchema = z.object({
  sectionId: z.string().uuid(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.'),
  startsAt: clockTime,
  endsAt: clockTime,
  roomId: z.string().uuid().optional(),
  invigilatorIds: z.array(z.string().uuid()).max(20).default([])
}).refine((entry) => entry.startsAt < entry.endsAt, {
  message: 'The exam must end after it starts.',
  path: ['endsAt']
});

export const examCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  termId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  subjectId: z.string().uuid(),
  examTypeId: z.string().uuid(),
  maxValue: z.number().positive().max(1000).refine((value) => Number.isInteger(value * 100), {
    message: 'Maximum mark supports at most two decimal places.'
  }).default(100),
  scheduleEntries: z.array(examScheduleEntrySchema).max(100).default([])
});

export const examScheduleEntryUpdateSchema = examScheduleEntrySchema;

export const examUpdateSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  maxValue: z.number().positive().max(1000).refine((value) => Number.isInteger(value * 100), {
    message: 'Maximum mark supports at most two decimal places.'
  }).optional()
}).refine((value) => Object.keys(value).length > 0);
