import { z } from 'zod';

export const moneyAmount = z.number().positive().max(99999999.99)
  .refine((value) => Number.isInteger(value * 100), 'Amount supports at most two decimal places.');
export const feeItemSchema = z.object({
  code: z.string().trim().min(1).max(32),
  nameEn: z.string().trim().min(1).max(120),
  nameAm: z.string().trim().min(1).max(120),
  amount: moneyAmount,
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/)
});
export const invoiceSchema = z.object({
  studentId: z.string().uuid(),
  dueDate: z.string().date().nullable().optional(),
  lines: z.array(z.object({
    feeItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000)
  })).min(1).max(30)
}).superRefine((invoice, context) => {
  const itemIds = invoice.lines.map((line) => line.feeItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Each fee item may appear only once; set its quantity instead.', path: ['lines'] });
  }
});
export const feePaymentSchema = z.object({
  amount: moneyAmount,
  method: z.enum(['cash', 'bank_transfer', 'mobile_money', 'other']),
  reference: z.string().trim().max(120).optional().default('')
}).superRefine((payment, context) => {
  if (['bank_transfer', 'mobile_money'].includes(payment.method) && !payment.reference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A reference is required for bank transfer and mobile money.',
      path: ['reference']
    });
  }
});
export const feeReversalSchema = z.object({
  amount: moneyAmount,
  reason: z.string().trim().min(3).max(500)
});
export const invoiceVoidSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const feeItemUpdateSchema = feeItemSchema.extend({ isActive: z.boolean() });
export const cashierShiftOpenSchema = z.object({
  openingFloat: z.number().nonnegative().max(99999999.99)
    .refine((value) => Number.isInteger(value * 100), 'Amount supports at most two decimal places.'),
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/)
});
export const cashierShiftCloseSchema = z.object({
  closingCash: z.number().nonnegative().max(99999999.99)
    .refine((value) => Number.isInteger(value * 100), 'Amount supports at most two decimal places.')
});
export const feeExpenseSchema = z.object({
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(3).max(500),
  amount: moneyAmount,
  currencyCode: z.string().trim().regex(/^[A-Z]{3}$/),
  method: z.enum(['cash', 'bank_transfer', 'mobile_money', 'other']),
  reference: z.string().trim().max(120).optional().default('')
}).superRefine((expense, context) => {
  if (['bank_transfer', 'mobile_money'].includes(expense.method) && !expense.reference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A reference is required for bank transfer and mobile money.',
      path: ['reference']
    });
  }
});
export const feeReportRangeSchema = z.object({
  from: z.string().date(),
  to: z.string().date()
}).superRefine((range, context) => {
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000;
  if (range.from > range.to) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Start date must not be after end date.', path: ['from'] });
  } else if (days > 366) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Date range cannot exceed 367 calendar days.', path: ['to'] });
  }
});
