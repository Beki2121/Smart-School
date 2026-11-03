import { z } from 'zod';

const assignmentFields = {
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),
  gradeLevelId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectId: z.string().uuid(),
  title: z.string().trim().min(2).max(180),
  instructions: z.string().trim().min(1).max(10000),
  dueAt: z.string().datetime({ offset: true })
};

export const assignmentCreateSchema = z.object(assignmentFields);
export const assignmentUpdateSchema = z.object({
  ...assignmentFields
}).partial().refine((value) => Object.keys(value).length > 0);
export const assignmentTransitionSchema = z.object({
  status: z.enum(['published', 'closed', 'archived'])
});
export const assignmentGradeSchema = z.object({
  grade: z.number().min(0).max(1000).refine((value) => Number.isInteger(value * 100)),
  feedback: z.string().trim().max(10000).nullable().optional()
});
export const assignmentSubmissionSchema = z.object({
  text: z.string().trim().max(10000).nullable().optional()
}).refine((value) => value.text !== undefined);
export const assignmentAttachmentSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum([
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ])
});
