import { z } from 'zod';

const uuid = z.string().uuid();
const minorUnits = z.number().int().safe().nonnegative();
const adjustmentMinorUnits = z.number().int().safe();
const currencyCode = z.string().trim().regex(/^[A-Z]{3}$/);
const itemSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(100),
  amountMinor: minorUnits
});

const ruleConfigurationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flat_rate'), rateBps: z.number().int().min(0).max(10000) }),
  z.object({
    type: z.literal('brackets'),
    brackets: z.array(z.object({
      upToMinor: minorUnits.nullable(),
      rateBps: z.number().int().min(0).max(10000)
    })).min(1).max(30)
  }).refine(({ brackets }) => {
    let previous = -1;
    for (const bracket of brackets) {
      if (bracket.upToMinor !== null && bracket.upToMinor <= previous) return false;
      if (bracket.upToMinor !== null) previous = bracket.upToMinor;
    }
    return brackets.filter((bracket) => bracket.upToMinor === null).length <= 1 &&
      (brackets.at(-1)?.upToMinor === null || !brackets.some((item) => item.upToMinor === null));
  }, 'Rate brackets must be ordered with an optional open-ended final bracket.')
]);

export const payrollRuleSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['tax', 'pension']),
  configuration: ruleConfigurationSchema,
  idempotencyKey: z.string().trim().min(1).max(100)
});

export const payrollSalaryStructureSchema = z.object({
  staffId: uuid,
  currencyCode,
  basicSalaryMinor: minorUnits,
  allowances: z.array(itemSchema).max(50).default([]),
  deductions: z.array(itemSchema).max(50).default([]),
  taxRuleId: uuid.nullable().optional(),
  pensionRuleId: uuid.nullable().optional(),
  overtimeRateMinorPerHour: minorUnits.default(0),
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(100)
}).refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: 'Effective end date must be on or after the start date.',
  path: ['effectiveTo']
});

export const payrollSalaryStructureUpdateSchema = z.object({
  currencyCode: currencyCode.optional(),
  basicSalaryMinor: minorUnits.optional(),
  allowances: z.array(itemSchema).max(50).optional(),
  deductions: z.array(itemSchema).max(50).optional(),
  taxRuleId: uuid.nullable().optional(),
  pensionRuleId: uuid.nullable().optional(),
  overtimeRateMinorPerHour: minorUnits.optional(),
  effectiveTo: z.string().date().nullable().optional(),
  status: z.enum(['active', 'inactive']).optional()
}).strict();

export const payrollPeriodSchema = z.object({
  code: z.string().trim().min(1).max(32),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  idempotencyKey: z.string().trim().min(1).max(100)
}).refine((value) => value.endsOn >= value.startsOn &&
  value.startsOn.slice(0, 7) === value.endsOn.slice(0, 7), {
  message: 'A payroll period must be an ordered date range within one calendar month.',
  path: ['endsOn']
});

export const payrollPeriodIdSchema = uuid;
export const payrollRunIdSchema = uuid;
export const payrollLineIdSchema = uuid;
export const payrollPayslipIdSchema = uuid;
export const payrollStructureIdSchema = uuid;

export const payrollInputSchema = z.object({
  attendanceDays: z.number().int().min(0).max(366),
  overtimeMinutes: z.number().int().min(0).max(100000),
  bonusMinor: minorUnits,
  adjustmentMinor: adjustmentMinorUnits,
  adjustmentReason: z.string().trim().max(500).default('')
}).refine((value) => value.adjustmentMinor === 0 || value.adjustmentReason.length > 0, {
  message: 'A reason is required for a non-zero adjustment.',
  path: ['adjustmentReason']
});

export const payrollRunSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(100)
});

export const payrollCalculateSchema = z.object({
  allowNegativeNet: z.boolean().default(false),
  overrideReason: z.string().trim().max(500).optional()
}).refine((value) => !value.allowNegativeNet || Boolean(value.overrideReason), {
  message: 'A reason is required for a negative-net override.',
  path: ['overrideReason']
});

export const payrollDecisionSchema = z.object({
  reason: z.string().trim().min(1).max(1000)
});

export const payrollPaymentSchema = z.object({
  lineId: uuid,
  idempotencyKey: z.string().trim().min(1).max(100),
  reference: z.string().trim().min(1).max(120),
  amountMinor: minorUnits.refine((value) => value > 0),
  paymentDate: z.string().date()
});

export const payrollAdjustmentSchema = z.object({
  staffId: uuid,
  sourceLineId: uuid.nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(100),
  amountMinor: adjustmentMinorUnits.refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500)
});
