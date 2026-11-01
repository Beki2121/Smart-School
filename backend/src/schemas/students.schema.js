import { z } from 'zod';

export const guardianAccessSchema = z.object({
  isVerified: z.boolean(),
  canViewResults: z.boolean(),
  canViewFees: z.boolean()
}).refine((access) => access.isVerified || (!access.canViewResults && !access.canViewFees), {
  message: 'Unverified guardians cannot receive portal permissions.'
});
export const studentSchema = z.object({
  studentNo: z.string().trim().min(1).max(32),
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  gender: z.enum(['female', 'male', 'other']),
  dateOfBirth: z.string().date().nullable().optional(),
  guardianPhone: z.string().trim().min(7).max(32).nullable().optional(),
  previousSchool: z.string().trim().max(180).nullable().optional(),
  sectionName: z.string().trim().min(1).max(80)
});
export const studentProfileSchema = z.object({
  givenNameAm: z.string().trim().min(1).max(100).optional(),
  fatherNameAm: z.string().trim().min(1).max(100).optional(),
  grandfatherNameAm: z.string().trim().min(1).max(100).optional(),
  givenNameEn: z.string().trim().min(1).max(100).optional(),
  fatherNameEn: z.string().trim().min(1).max(100).optional(),
  grandfatherNameEn: z.string().trim().min(1).max(100).optional(),
  gender: z.enum(['female', 'male', 'other']).optional(),
  dateOfBirth: z.string().date().nullable().optional(),
  guardianPhone: z.string().trim().min(7).max(32).nullable().optional(),
  previousSchool: z.string().trim().max(180).nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one student profile field to update.'
});
export const studentSensitiveDataSchema = z.object({
  idNumber: z.string().trim().max(128).nullable().optional(),
  healthNotes: z.string().trim().max(10000).nullable().optional(),
  specialNeeds: z.string().trim().max(10000).nullable().optional(),
  allergies: z.string().trim().max(10000).nullable().optional()
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Provide at least one protected student field to update.'
});
export const studentGuardianSchema = z.object({
  givenNameAm: z.string().trim().min(1).max(100),
  fatherNameAm: z.string().trim().min(1).max(100),
  grandfatherNameAm: z.string().trim().min(1).max(100),
  givenNameEn: z.string().trim().min(1).max(100),
  fatherNameEn: z.string().trim().min(1).max(100),
  grandfatherNameEn: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(32),
  email: z.string().trim().email().max(254).nullable().optional(),
  relationship: z.string().trim().min(2).max(40),
  isPrimary: z.boolean().optional().default(false)
});
export const studentEmergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(32),
  relationship: z.string().trim().min(2).max(60),
  priority: z.number().int().min(1).max(10).default(1)
});
export const disciplineRecordSchema = z.object({
  recordedOn: z.string().date(),
  category: z.string().trim().min(2).max(80),
  details: z.string().trim().min(3).max(5000),
  actionTaken: z.string().trim().max(5000).nullable().optional()
});
export const studentTransferPackageSchema = z.object({
  recipientSchool: z.string().trim().min(2).max(180),
  guardianName: z.string().trim().min(2).max(180),
  guardianRelationship: z.string().trim().min(2).max(60),
  consentRecordedOn: z.string().date(),
  consentDocumentId: z.string().uuid()
});
export const studentStatusSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const studentProgressionSchema = z.object({
  outcome: z.enum(['promoted', 'repeated', 'graduated']),
  sectionId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500),
  overrideReason: z.string().trim().min(5).max(500).optional()
}).superRefine((data, context) => {
  if (data.outcome === 'graduated' && data.sectionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Graduated students cannot be assigned to a section.', path: ['sectionId'] });
  }
  if (data.outcome !== 'graduated' && !data.sectionId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a section in the newly active academic year.', path: ['sectionId'] });
  }
});
export const studentCommendationSchema = z.object({
  recordedOn: z.string().date(),
  titleEn: z.string().trim().min(2).max(180),
  titleAm: z.string().trim().min(2).max(180),
  descriptionEn: z.string().trim().min(1).max(2000),
  descriptionAm: z.string().trim().min(1).max(2000)
});
