export function attendanceCorrectionWindowOpen(date) {
  const [year, month, day] = date.split('-').map(Number);
  const attendanceDayStart = Date.UTC(year, month - 1, day) - 3 * 60 * 60 * 1000;
  return Date.now() <= attendanceDayStart + 48 * 60 * 60 * 1000;
}

export function attendanceCorrectionConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = 'ATTENDANCE_CORRECTION_CONFLICT';
  return error;
}

export function buildAttendanceSummary(rows, from, to) {
  const createTotals = () => ({
    sessions: 0, records: 0, present: 0, absent: 0, late: 0, excused: 0, attendanceRate: null
  });
  const sectionTotals = new Map();
  const dailyTotals = new Map();
  const all = createTotals();
  const allSessions = new Set();
  const sectionSessions = new Map();
  const dailySessions = new Map();
  for (const row of rows) {
    const date = String(row.date).slice(0, 10);
    let section = sectionTotals.get(row.sectionId);
    if (!section) {
      section = { sectionId: row.sectionId, sectionName: row.sectionName, ...createTotals() };
      sectionTotals.set(row.sectionId, section);
    }
    let daily = dailyTotals.get(date);
    if (!daily) {
      daily = { date, ...createTotals() };
      dailyTotals.set(date, daily);
    }
    all.records += 1;
    section.records += 1;
    daily.records += 1;
    if (Object.hasOwn(all, row.status) && typeof all[row.status] === 'number') {
      all[row.status] += 1;
      section[row.status] += 1;
      daily[row.status] += 1;
    }
    allSessions.add(row.sessionId);
    if (!sectionSessions.has(row.sectionId)) sectionSessions.set(row.sectionId, new Set());
    sectionSessions.get(row.sectionId).add(row.sessionId);
    if (!dailySessions.has(date)) dailySessions.set(date, new Set());
    dailySessions.get(date).add(row.sessionId);
  }
  const complete = (totals, sessions) => {
    totals.sessions = sessions.size;
    const eligible = totals.present + totals.absent + totals.late;
    totals.attendanceRate = eligible ? Math.round(((totals.present + totals.late) / eligible) * 1000) / 10 : null;
    return totals;
  };
  complete(all, allSessions);
  const bySection = [...sectionTotals.values()].map((totals) =>
    complete(totals, sectionSessions.get(totals.sectionId)));
  const byDate = [...dailyTotals.values()].sort((a, b) => a.date.localeCompare(b.date))
    .map((totals) => complete(totals, dailySessions.get(totals.date)));
  return { from, to, totals: all, bySection, byDate };
}
