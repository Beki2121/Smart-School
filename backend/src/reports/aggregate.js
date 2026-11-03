function percent(value, maximum) {
  if (!maximum) return 0;
  return Math.round((Number(value) / Number(maximum)) * 10000) / 100;
}

export function aggregateTeacherWorkload(assignments, limit = 25) {
  const grouped = new Map();
  for (const assignment of assignments) {
    const teacher = grouped.get(assignment.staffId) ?? {
      teacher: assignment.staffName, classes: new Set(), periods: 0
    };
    teacher.classes.add(assignment.sectionId);
    if (assignment.periodNumber != null) teacher.periods += 1;
    grouped.set(assignment.staffId, teacher);
  }
  return [...grouped.values()].map(({ classes, periods, ...teacher }) => ({
    ...teacher, classes: classes.size, periods, limit, warning: periods > limit
  }));
}

export function syllabusCoveragePercent(coveredUnits, units) {
  return percent(coveredUnits, units);
}

function moneyMinorUnits(value) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? 0));
  if (!match) throw new TypeError('Finance report amount is not a decimal value.');
  const [, sign, whole, fraction = ''] = match;
  let minor = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  if (fraction[2] >= '5') minor += 1n;
  return Number(sign === '-' ? -minor : minor);
}

function minorUnitsAmount(value) {
  return value / 100;
}

function groupBy(rows, keyOf, create) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const current = groups.get(key) ?? create(row);
    groups.set(key, current);
    current.add(row);
  }
  return [...groups.values()].map(({ add, ...row }) => row);
}

export function aggregateReportRows(reportId, source) {
  if (reportId === 'attendance-class' || reportId === 'attendance-student' ||
      reportId === 'attendance-trend') {
    const keyOf = (row) => reportId === 'attendance-class'
      ? `${row.date}:${row.sectionId}`
      : reportId === 'attendance-student' ? row.studentId : row.date;
    return groupBy(source, keyOf, (row) => ({
      date: reportId === 'attendance-trend' || reportId === 'attendance-class' ? row.date : undefined,
      grade: reportId === 'attendance-class' ? row.grade : undefined,
      section: reportId === 'attendance-class' ? row.section : undefined,
      sectionId: reportId === 'attendance-class' ? row.sectionId : undefined,
      studentNo: reportId === 'attendance-student' ? row.studentNo : undefined,
      name: reportId === 'attendance-student' ? row.name : undefined,
      present: 0, absent: 0, late: 0, excused: 0,
      add(item) {
        this[item.status] = (this[item.status] ?? 0) + 1;
      }
    })).map((row) => {
      const count = row.present + row.absent + row.late;
      return { ...row, attendanceRate: count ? percent(row.present + row.late, count) : 0 };
    });
  }
  if (reportId === 'academic-pass-rates' || reportId === 'subject-performance' ||
      reportId === 'class-comparison') {
    const keyOf = (row) => reportId === 'academic-pass-rates'
      ? `${row.grade}:${row.section}`
      : reportId === 'subject-performance' ? row.subject : `${row.grade}:${row.section}`;
    return groupBy(source, keyOf, (row) => ({
      grade: reportId !== 'subject-performance' ? row.grade : undefined,
      section: reportId !== 'subject-performance' ? row.section : undefined,
      subject: reportId === 'subject-performance' ? row.subject : undefined,
      students: new Set(),
      scoreTotal: 0, scores: 0, passed: 0, failed: 0,
      add(item) {
        const score = percent(item.value, item.maxValue);
        this.students.add(item.studentId);
        this.scoreTotal += score;
        this.scores += 1;
        if (score >= 50) this.passed += 1;
        else this.failed += 1;
      }
    })).map((row) => ({
      ...row,
      students: row.students.size,
      average: row.scores ? Math.round((row.scoreTotal / row.scores) * 100) / 100 : 0,
      passRate: row.scores ? percent(row.passed, row.scores) : 0
    }));
  }
  if (reportId === 'admissions-enrolment') {
    const { grades, admissions, sections, enrolments } = source;
    const gradesById = new Map(grades.map((row) => [row.id, row]));
    const admissionsByGrade = new Map();
    for (const admission of admissions) {
      const current = admissionsByGrade.get(admission.gradeLevelId) ?? { applications: 0, enrolled: 0 };
      current.applications += 1;
      if (admission.status === 'enrolled') current.enrolled += 1;
      admissionsByGrade.set(admission.gradeLevelId, current);
    }
    const rows = new Map();
    for (const section of sections) {
      const grade = gradesById.get(section.gradeLevelId);
      if (!grade) continue;
      const current = rows.get(grade.id) ?? {
        grade: grade.name, applications: admissionsByGrade.get(grade.id)?.applications ?? 0,
        enrolled: admissionsByGrade.get(grade.id)?.enrolled ?? 0,
        capacity: 0, unlimited: false, activeEnrolled: 0
      };
      if (section.capacity == null) current.unlimited = true;
      else current.capacity += section.capacity;
      current.activeEnrolled += enrolments.filter((item) =>
        item.sectionId === section.id && item.status === 'active').length;
      rows.set(grade.id, current);
    }
    for (const [gradeId, counts] of admissionsByGrade) {
      if (rows.has(gradeId)) continue;
      const grade = gradesById.get(gradeId);
      if (grade) rows.set(gradeId, {
        grade: grade.name, applications: counts.applications, enrolled: counts.enrolled,
        capacity: 0, unlimited: false, activeEnrolled: 0
      });
    }
    return [...rows.values()].map((row) => ({
      grade: row.grade, applications: row.applications, enrolled: row.enrolled,
      availableSeats: row.unlimited ? null : Math.max(0, row.capacity - row.activeEnrolled)
    }));
  }
  if (reportId === 'finance-collection') {
    return groupBy(source, (row) =>
      `${row.date}:${row.className}:${row.feeTypes}:${row.currencyCode}`,
    (row) => ({
      date: row.date, class: row.className, feeType: row.feeTypes,
      currency: row.currencyCode, amountMinor: 0,
      add(item) {
        const sign = item.entryType === 'reversal' ? -1 : 1;
        this.amountMinor += sign * moneyMinorUnits(item.amount);
      }
    })).map(({ amountMinor, ...row }) => ({
      ...row, collected: minorUnitsAmount(amountMinor)
    }));
  }
  if (reportId === 'finance-arrears') {
    return source.map((row) => ({
      studentNo: row.studentNo, name: row.studentName, grade: row.grade ?? '',
      section: row.sectionName, currency: row.currencyCode, outstanding: row.balanceDue
    }));
  }
  return source;
}

export function summarizeReport(reportId, rows) {
  const summary = { records: rows.length };
  if (reportId.startsWith('attendance-')) {
    summary.present = rows.reduce((total, row) => total + row.present, 0);
    summary.absent = rows.reduce((total, row) => total + row.absent, 0);
    summary.late = rows.reduce((total, row) => total + row.late, 0);
  }
  if (reportId === 'finance-collection') {
    const amounts = new Map();
    for (const row of rows) {
      amounts.set(row.currency, (amounts.get(row.currency) ?? 0) + moneyMinorUnits(row.collected));
    }
    summary.collectedByCurrency = Object.fromEntries([...amounts]
      .map(([currency, amount]) => [currency, minorUnitsAmount(amount)]));
  }
  if (reportId === 'academic-pass-rates' || reportId === 'subject-performance' ||
      reportId === 'class-comparison') {
    summary.passed = rows.reduce((total, row) => total + row.passed, 0);
    summary.failed = rows.reduce((total, row) => total + row.failed, 0);
  }
  return summary;
}

export function reportDateRange(filters, year, today) {
  const from = filters.from ?? year?.startDate ?? `${today.slice(0, 4)}-01-01`;
  const to = filters.to ?? year?.endDate ?? today;
  if (from > to) {
    const error = new Error('Report start date must be on or before its end date.');
    error.status = 400;
    error.code = 'REPORT_DATE_RANGE_INVALID';
    throw error;
  }
  return { from, to };
}

export function reportTooLarge() {
  const error = new Error('This report exceeds the safe result limit. Narrow the filters and try again.');
  error.status = 413;
  error.code = 'REPORT_RESULT_TOO_LARGE';
  return error;
}
