import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ethiopianToGregorian, formatEthiopianDate, gregorianToEthiopian,
  isEthiopianLeapYear
} from '../src/calendar.js';

describe('Ethiopian calendar', () => {
  it('converts Ethiopian new year to the expected Gregorian date', () => {
    assert.deepEqual(ethiopianToGregorian({ year: 2017, month: 1, day: 1 }), {
      year: 2024, month: 9, day: 11
    });
    assert.deepEqual(gregorianToEthiopian({ year: 2024, month: 9, day: 11 }), {
      year: 2017, month: 1, day: 1
    });
  });

  it('uses Pagume 6 for leap years and 5 otherwise', () => {
    assert.equal(isEthiopianLeapYear(2015), true);
    assert.equal(isEthiopianLeapYear(2016), false);
    assert.deepEqual(ethiopianToGregorian({ year: 2015, month: 13, day: 6 }), {
      year: 2023, month: 9, day: 11
    });
    assert.throws(() => ethiopianToGregorian({ year: 2016, month: 13, day: 6 }), RangeError);
  });

  it('round-trips Gregorian dates across a century', () => {
    for (let year = 1920; year <= 2025; year += 1) {
      for (const [month, day] of [[1, 1], [3, 1], [6, 15], [9, 11], [12, 31]]) {
        const ethiopian = gregorianToEthiopian({ year, month, day });
        assert.deepEqual(ethiopianToGregorian(ethiopian), { year, month, day });
      }
    }
  });

  it('formats Amharic and English Ethiopian dates', () => {
    assert.match(formatEthiopianDate({ year: 2024, month: 9, day: 11 }), /Meskerem 1, 2017 E\.C\./);
    assert.match(formatEthiopianDate({ year: 2024, month: 9, day: 11 }, 'am'), /መስከረም 1, 2017/);
  });
});
