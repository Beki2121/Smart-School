import { z } from 'zod';

export const accountStatusSchema = z.object({ isActive: z.boolean() });

export const staffInvitationRoles = [
  'principal', 'registrar', 'system_admin', 'academic_head', 'homeroom_teacher',
  'subject_teacher', 'hr_admin', 'accountant_cashier', 'counsellor'
];

export const accountInvitationSchema = z.object({
  targetType: z.enum(['staff', 'student', 'guardian']),
  targetId: z.string().uuid(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum([...staffInvitationRoles, 'owner_director']).optional()
}).superRefine((data, context) => {
  if (data.targetType === 'staff' && !data.role) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a staff account role.', path: ['role'] });
  }
  if (data.targetType !== 'staff' && data.role) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only staff invitations can select a role.', path: ['role'] });
  }
});
