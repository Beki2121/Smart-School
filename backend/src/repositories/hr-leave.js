export function proratedLeaveEntitlementHalfDays(annualHalfDays, hiredOn, year) {
  if (!hiredOn) return annualHalfDays;
  const firstDay = `${year}-01-01`;
  const lastDay = `${year}-12-31`;
  if (hiredOn <= firstDay) return annualHalfDays;
  if (hiredOn > lastDay) return 0;
  const yearDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
  const eligibleDays = (Date.parse(`${lastDay}T00:00:00Z`) -
    Date.parse(`${hiredOn}T00:00:00Z`)) / 86400000 + 1;
  return Math.floor(annualHalfDays * eligibleDays / yearDays);
}
