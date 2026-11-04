import { z } from 'zod';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const date = z.string().date();
export const libraryIdSchema = uuid;
export const libraryBarcodeSchema = z.string().trim().min(1).max(100);
export const libraryBookSchema = z.object({
  categoryId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(240),
  author: z.string().trim().min(1).max(200),
  isbn: z.string().trim().max(32).nullable().optional(),
  publisher: z.string().trim().max(200).default(''),
  description: z.string().trim().max(2000).default('')
}).strict();
export const libraryCategorySchema = z.object({ name }).strict();
export const libraryCopySchema = z.object({
  bookId: uuid,
  copyNumber: z.string().trim().min(1).max(60),
  barcode: z.string().trim().min(1).max(100),
  condition: z.enum(['new', 'good', 'worn', 'damaged', 'lost']).default('good'),
  shelfLocation: z.string().trim().max(120).default('')
}).strict();
export const libraryMemberSchema = z.object({
  memberType: z.enum(['student', 'staff']),
  studentId: uuid.optional(),
  staffId: uuid.optional()
}).strict().refine((value) => (value.memberType === 'student' && Boolean(value.studentId) && !value.staffId) ||
  (value.memberType === 'staff' && Boolean(value.staffId) && !value.studentId), {
  message: 'Select exactly one student or staff member.'
});
export const librarySettingsSchema = z.object({
  loanPeriodDays: z.number().int().min(1).max(365),
  maxActiveLoans: z.number().int().min(1).max(100),
  maxRenewals: z.number().int().min(0).max(20),
  fineMinorPerDay: z.number().int().safe().nonnegative(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/)
}).strict();
export const libraryIssueSchema = z.object({
  copyId: uuid, memberId: uuid, issuedOn: date, idempotencyKey: z.string().trim().min(1).max(100)
}).strict();
export const libraryReturnSchema = z.object({
  returnCondition: z.enum(['new', 'good', 'worn', 'damaged', 'lost']),
  returnedOn: date
}).strict();
export const libraryRenewSchema = z.object({ dueOn: date.optional() }).strict();
export const libraryReservationSchema = z.object({
  bookId: uuid, memberId: uuid, idempotencyKey: z.string().trim().min(1).max(100)
}).strict();
export const libraryFineStatusSchema = z.object({
  status: z.literal('paid'), paidOn: date
}).strict();
export const libraryFineWaiverSchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict();
export const libraryListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(20).optional(),
  categoryId: uuid.optional(),
  barcode: z.string().trim().max(100).optional()
}).strict();
