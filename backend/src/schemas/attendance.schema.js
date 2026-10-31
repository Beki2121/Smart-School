import { z } from 'zod';

export const attendanceSchema = z.object({
  clientUuid: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sectionId: z.string().uuid(),
  records: z.array(z.object({
    studentId: z.string().uuid(),
    status: z.enum(['present', 'absent', 'late', 'excused'])
  })).min(1).max(100)
}).superRefine((data, context) => {
  const ids = data.records.map((record) => record.studentId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Each student may appear only once.', path: ['records'] });
  }
});
export const attendanceCorrectionSchema = z.object({
  status: z.enum(['present', 'absent', 'late', 'excused']),
  reason: z.string().trim().min(3).max(500)
});
export const attendanceCorrectionReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().min(3).max(500)
});
