function assertMinor(value, field) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${field} must be a safe integer minor-unit amount.`);
  return value;
}

export function roundHalfUp(numerator, denominator) {
  assertMinor(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError('denominator must be a positive safe integer.');
  }
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  const absolute = top < 0n ? -top : top;
  const rounded = (absolute * 2n + bottom) / (bottom * 2n);
  const signed = top < 0n ? -rounded : rounded;
  const result = Number(signed);
  return assertMinor(result, 'rounded amount');
}

function roundProductHalfUp(value, multiplier, denominator) {
  assertMinor(value, 'amount');
  if (!Number.isSafeInteger(multiplier) || multiplier < 0 ||
      !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError('Multiplier and denominator must be safe nonnegative integers.');
  }
  const top = BigInt(value) * BigInt(multiplier);
  const bottom = BigInt(denominator);
  const rounded = (top * 2n + bottom) / (bottom * 2n);
  return assertMinor(Number(rounded), 'rounded amount');
}

export function calculateRuleAmount(amountMinor, configuration) {
  assertMinor(amountMinor, 'taxable amount');
  if (amountMinor <= 0) return 0;
  if (configuration.type === 'flat_rate') {
    return roundProductHalfUp(amountMinor, configuration.rateBps, 10000);
  }
  let amount = 0;
  let lowerBound = 0;
  let remainder = amountMinor;
  for (const bracket of configuration.brackets) {
    const upperBound = bracket.upToMinor ?? amountMinor;
    const portion = Math.max(0, Math.min(remainder, upperBound - lowerBound));
    amount = assertMinor(amount +
      roundProductHalfUp(portion, bracket.rateBps, 10000), 'rule amount');
    remainder -= portion;
    if (remainder <= 0 || bracket.upToMinor === null) break;
    lowerBound = upperBound;
  }
  return assertMinor(amount, 'rule amount');
}

function sumComponents(components) {
  return components.reduce((total, item) =>
    assertMinor(total + assertMinor(item.amountMinor, 'component amount'), 'component total'), 0);
}

function daysBetweenInclusive(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) -
    Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

export function calculatePayrollLine({ period, staff, structure, input, adjustments = [],
  taxRule = null, pensionRule = null }) {
  const monthDays = new Date(Date.UTC(
    Number(period.startsOn.slice(0, 4)), Number(period.startsOn.slice(5, 7)), 0
  )).getUTCDate();
  const firstDay = period.startsOn > (staff.hiredOn ?? period.startsOn)
    ? period.startsOn : (staff.hiredOn ?? period.startsOn);
  const eligibleDays = firstDay > period.endsOn ? 0 : daysBetweenInclusive(firstDay, period.endsOn);
  const unpaidHalfDays = Math.min(input.sourceUnpaidLeaveHalfDays ?? 0, eligibleDays * 2);
  const dailyBaseDenominator = monthDays * 2;
  const proratedBaseMinor = roundProductHalfUp(
    structure.basicSalaryMinor, eligibleDays, monthDays
  );
  const unpaidLeaveDeductionMinor = roundProductHalfUp(
    structure.basicSalaryMinor, unpaidHalfDays, dailyBaseDenominator
  );
  const allowanceMinor = roundProductHalfUp(
    sumComponents(structure.allowances), eligibleDays, monthDays
  );
  const otherDeductionsMinor = roundProductHalfUp(
    sumComponents(structure.deductions), eligibleDays, monthDays
  );
  const overtimeMinor = roundProductHalfUp(
    structure.overtimeRateMinorPerHour, input.overtimeMinutes, 60
  );
  const adjustmentMinor = assertMinor(input.adjustmentMinor +
    adjustments.reduce((total, item) => assertMinor(total + item.amountMinor, 'adjustment total'), 0),
  'adjustment amount');
  const grossMinor = assertMinor(
    proratedBaseMinor + allowanceMinor + overtimeMinor + input.bonusMinor + adjustmentMinor,
    'gross amount'
  );
  const taxableMinor = Math.max(0, grossMinor - unpaidLeaveDeductionMinor);
  const taxMinor = taxRule ? calculateRuleAmount(taxableMinor, taxRule.configuration) : 0;
  const pensionMinor = pensionRule
    ? calculateRuleAmount(taxableMinor, pensionRule.configuration) : 0;
  const netMinor = assertMinor(
    grossMinor - unpaidLeaveDeductionMinor - taxMinor - pensionMinor - otherDeductionsMinor,
    'net amount'
  );
  return {
    currencyCode: structure.currencyCode,
    baseSalaryMinor: structure.basicSalaryMinor,
    proratedBaseMinor,
    allowancesMinor: allowanceMinor,
    overtimeMinor,
    bonusMinor: input.bonusMinor,
    adjustmentMinor,
    unpaidLeaveDeductionMinor,
    taxMinor,
    pensionMinor,
    otherDeductionsMinor,
    grossMinor,
    netMinor,
    calculationDetails: {
      attendanceDays: input.attendanceDays,
      overtimeMinutes: input.overtimeMinutes,
      unpaidLeaveHalfDays: unpaidHalfDays,
      eligibleDays,
      daysInMonth: monthDays,
      rounding: 'half-up to the nearest minor unit at each line component',
      taxRuleId: taxRule?.id ?? null,
      pensionRuleId: pensionRule?.id ?? null
    }
  };
}

export function payrollInputFingerprint(inputs) {
  return inputs.map((input) => [
    input.staffId, input.attendanceDays, input.overtimeMinutes, input.bonusMinor,
    input.adjustmentMinor, input.sourceAttendanceDays, input.sourceUnpaidLeaveHalfDays
  ].join(':')).sort().join('|');
}
