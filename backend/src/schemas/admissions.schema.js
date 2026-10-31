import { z } from 'zod';

export const admissionSchema = z.object({
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  gender: z.enum(['female', 'male', 'other']),
  dateOfBirth: z.string().date().nullable().optional(),
  guardianName: z.string().trim().min(2).max(180),
  guardianPhone: z.string().trim().min(7).max(32),
  guardianEmail: z.string().trim().email().max(254).nullable().optional(),
  gradeLevelId: z.string().uuid(),
  previousSchool: z.string().trim().max(180).nullable().optional()
});
export const publicAdmissionSchema = admissionSchema.extend({
  privacyConsent: z.literal(true)
});
export const studentDocumentTypeSchema = z.enum([
  'photo', 'birth_certificate', 'previous_school_record', 'transfer_consent', 'other'
]);
export const admissionStatusSchema = z.object({
  status: z.enum(['application', 'accepted', 'waitlisted', 'rejected']),
  decisionNote: z.string().trim().max(2000).optional().default('')
});
export const interviewSchema = z.object({
  interviewAt: z.string().datetime(),
  interviewResult: z.enum(['pending', 'passed', 'failed']).default('pending')
});
export const admissionEnrolmentSchema = z.object({
  sectionId: z.string().uuid(),
  siblingStudentId: z.string().uuid().nullable().optional()
});
export const studentIdPatternSchema = z.object({
  pattern: z.string().trim().min(1).max(80).refine((value) => {
    const literal = value.replace(/\{(?:CAMPUS|YEAR|SEQ)\}/g, '');
    return value.includes('{SEQ}') && !/[{}]/.test(literal) && /^[A-Za-z0-9._ -]*$/.test(literal);
  }, {
    message: 'Use {CAMPUS}, {YEAR}, and {SEQ} tokens, including {SEQ}.'
  })
});
