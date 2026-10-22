const ETHIOPIAN_EPOCH_JDN = 1724221;
const monthsEn = ['Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit', 'Megabit', 'Miazia', 'Ginbot', 'Sene', 'Hamle', 'Nehasse', 'Pagume'];
const monthsAm = ['መስከረም', 'ጥቅምት', 'ህዳር', 'ታህሳስ', 'ጥር', 'የካቲት', 'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜ'];

function toJdn(year: number, month: number, day: number) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y +
    Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function gregorianToEthiopian(date: { year: number; month: number; day: number }) {
  const jdn = toJdn(date.year, date.month, date.day);
  const cycle = Math.floor((jdn - ETHIOPIAN_EPOCH_JDN) / 1461);
  let remaining = (jdn - ETHIOPIAN_EPOCH_JDN) % 1461;
  let year = cycle * 4 + 1;
  for (const days of [365, 365, 366, 365]) {
    if (remaining < days) break;
    remaining -= days;
    year += 1;
  }
  return { year, month: Math.floor(remaining / 30) + 1, day: remaining % 30 + 1 };
}

export function formatEthiopianDate(date: { year: number; month: number; day: number }, locale: 'en' | 'am') {
  const et = gregorianToEthiopian(date);
  const monthName = locale === 'am' ? monthsAm[et.month - 1] : monthsEn[et.month - 1];
  return locale === 'am' ? `${monthName} ${et.day}, ${et.year} ዓ.ም.` : `${monthName} ${et.day}, ${et.year} E.C.`;
}
