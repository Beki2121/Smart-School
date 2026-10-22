const ETHIOPIAN_EPOCH_JDN = 1724221;
export const ETHIOPIAN_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehasse', 'Pagume'
];

export function isEthiopianLeapYear(year) {
  return year % 4 === 3;
}

export function ethiopianToJulianDay({ year, month, day }) {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 13) {
    throw new RangeError('Invalid Ethiopian year or month.');
  }
  const lastDay = month === 13 ? (isEthiopianLeapYear(year) ? 6 : 5) : 30;
  if (!Number.isInteger(day) || day < 1 || day > lastDay) throw new RangeError('Invalid Ethiopian day.');
  return ETHIOPIAN_EPOCH_JDN + 365 * (year - 1) + Math.floor(year / 4) + 30 * (month - 1) + day - 1;
}

export function gregorianToJulianDay({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError('Invalid Gregorian date.');
  }
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function julianDayToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor(146097 * b / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor(1461 * d / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1
  };
}

export function julianDayToEthiopian(jdn) {
  if (!Number.isInteger(jdn) || jdn < ETHIOPIAN_EPOCH_JDN) throw new RangeError('Date predates supported Ethiopian calendar.');
  const cycle = Math.floor((jdn - ETHIOPIAN_EPOCH_JDN) / 1461);
  let dayInCycle = (jdn - ETHIOPIAN_EPOCH_JDN) % 1461;
  let year = cycle * 4 + 1;
  for (const length of [365, 365, 366, 365]) {
    if (dayInCycle < length) break;
    dayInCycle -= length;
    year += 1;
  }
  return {
    year,
    month: Math.floor(dayInCycle / 30) + 1,
    day: dayInCycle % 30 + 1
  };
}

export function gregorianToEthiopian(date) {
  return julianDayToEthiopian(gregorianToJulianDay(date));
}

export function ethiopianToGregorian(date) {
  return julianDayToGregorian(ethiopianToJulianDay(date));
}

export function formatEthiopianDate(date, locale = 'en') {
  const { year, month, day } = gregorianToEthiopian(date);
  const monthName = ETHIOPIAN_MONTHS[month - 1];
  if (locale === 'am') {
    const amharicMonths = ['መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];
    return `${amharicMonths[month - 1]} ${day}, ${year} ዓ.ም.`;
  }
  return `${monthName} ${day}, ${year} E.C.`;
}
