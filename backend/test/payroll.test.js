import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  calculatePayrollLine, calculateRuleAmount, roundHalfUp
} from '../src/repositories/payroll.math.js';

describe('payroll calculation', () => {
  it('rounds integer minor-unit ratios half-up, including negative adjustments', () => {
    assert.equal(roundHalfUp(5, 2), 3);
    assert.equal(roundHalfUp(-5, 2), -3);
    assert.equal(roundHalfUp(4, 2), 2);
  });

  it('calculates configurable flat-rate and progressive bracket rules', () => {
    assert.equal(calculateRuleAmount(1, { type: 'flat_rate', rateBps: 5000 }), 1);
    assert.equal(calculateRuleAmount(158100, {
      type: 'brackets',
      brackets: [
        { upToMinor: 100000, rateBps: 100 },
        { upToMinor: null, rateBps: 250 }
      ]
    }), 2453);
  });

  it('prorates partial months and calculates overtime, adjustments, unpaid leave and deductions', () => {
    const result = calculatePayrollLine({
      period: { startsOn: '2026-03-01', endsOn: '2026-03-31' },
      staff: { hiredOn: '2026-03-16' },
      structure: {
        currencyCode: 'USD', basicSalaryMinor: 310000,
        allowances: [{ amountMinor: 3100 }], deductions: [{ amountMinor: 1000 }],
        overtimeRateMinorPerHour: 6000
      },
      input: {
        attendanceDays: 1, overtimeMinutes: 60, bonusMinor: 1000,
        adjustmentMinor: -500, sourceUnpaidLeaveHalfDays: 2
      },
      taxRule: { id: 'tax', configuration: { type: 'flat_rate', rateBps: 500 } },
      pensionRule: { id: 'pension', configuration: {
        type: 'brackets',
        brackets: [
          { upToMinor: 100000, rateBps: 100 },
          { upToMinor: null, rateBps: 250 }
        ]
      } }
    });

    assert.equal(result.currencyCode, 'USD');
    assert.equal(result.proratedBaseMinor, 160000);
    assert.equal(result.allowancesMinor, 1600);
    assert.equal(result.overtimeMinor, 6000);
    assert.equal(result.adjustmentMinor, -500);
    assert.equal(result.unpaidLeaveDeductionMinor, 10000);
    assert.equal(result.taxMinor, 7905);
    assert.equal(result.pensionMinor, 2453);
    assert.equal(result.otherDeductionsMinor, 516);
    assert.equal(result.netMinor, 147226);
    assert.equal(result.calculationDetails.rounding,
      'half-up to the nearest minor unit at each line component');
  });

  it('keeps currencies separate and supports exact-zero and negative adjustment inputs', () => {
    const calculate = (currencyCode, adjustmentMinor) => calculatePayrollLine({
      period: { startsOn: '2026-02-01', endsOn: '2026-02-28' },
      staff: { hiredOn: '2026-01-01' },
      structure: {
        currencyCode, basicSalaryMinor: 10000, allowances: [], deductions: [],
        overtimeRateMinorPerHour: 0
      },
      input: {
        attendanceDays: 0, overtimeMinutes: 0, bonusMinor: 0,
        adjustmentMinor, sourceUnpaidLeaveHalfDays: 0
      }
    });
    assert.equal(calculate('USD', 0).netMinor, 10000);
    assert.equal(calculate('EUR', -1000).netMinor, 9000);
    assert.equal(calculate('EUR', -1000).currencyCode, 'EUR');
  });
});
