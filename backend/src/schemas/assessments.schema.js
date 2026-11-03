import { z } from 'zod';

export const markSchema = z.object({
  clientUuid: z.string().uuid(),
  studentId: z.string().uuid(),
  examId: z.string().uuid().optional(),
  assessmentName: z.string().trim().min(1).max(100),
  termId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  maxValue: z.number().positive().max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Maximum mark supports at most two decimal places.'
  }),
  value: z.number().min(0).max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Mark supports at most two decimal places.'
  })
}).refine((row) => row.value <= row.maxValue, {
  message: 'Mark cannot exceed its maximum value.',
  path: ['value']
}).refine((row) => Boolean(row.termId) === Boolean(row.subjectId), {
  message: 'Select both a term and subject for report-card marks.',
  path: ['subjectId']
});
export const markAmendmentSchema = z.object({
  value: z.number().min(0).max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Mark supports at most two decimal places.'
  }),
  maxValue: z.number().positive().max(1000).refine((score) => Number.isInteger(score * 100), {
    message: 'Maximum mark supports at most two decimal places.'
  }),
  reason: z.string().trim().min(5).max(500)
}).refine((row) => row.value <= row.maxValue, {
  message: 'Mark cannot exceed its maximum value.',
  path: ['value']
});
export const gradingScaleSchema = z.object({
  bands: z.array(z.object({
    code: z.string().trim().min(1).max(24),
    nameEn: z.string().trim().min(1).max(80),
    nameAm: z.string().trim().min(1).max(80),
    minPercent: z.number().min(0).max(100).refine((value) => Number.isInteger(value * 100), {
      message: 'Grade thresholds support at most two decimal places.'
    })
  })).min(1).max(12)
}).superRefine(({ bands }, context) => {
  const codes = bands.map((band) => band.code.toLowerCase());
  const thresholds = bands.map((band) => band.minPercent);
  if (new Set(codes).size !== codes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Grading band codes must be unique.', path: ['bands'] });
  }
  if (new Set(thresholds).size !== thresholds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Grading thresholds must be unique.', path: ['bands'] });
  }
  if (!thresholds.includes(0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A grading scale must include a 0% threshold.', path: ['bands'] });
  }
});
export const gradingPolicySchema = z.object({
  scoringMethod: z.enum(['points_weighted', 'equal_subject_weighted'])
});
