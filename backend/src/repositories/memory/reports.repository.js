import { addisDate } from '../shared.js';
import {
  aggregateReportRows, aggregateTeacherWorkload, reportDateRange, reportTooLarge,
  summarizeReport, syllabusCoveragePercent
} from '../../reports/aggregate.js';
import { reportCatalog, reportPage } from '../../reports/catalog.js';

const MAX_REPORT_ROWS = 10000;

function forbiddenReport() {
  const error = new Error('You do not have permission to view this report.');
  error.status = 403;
  error.code = 'FORBIDDEN';
  return error;
}

function capRows(rows) {
  if (rows.length > MAX_REPORT_ROWS) throw reportTooLarge();
  return rows;
}

function dateInRange(value, from, to) {
  if (value == null) return true;
  const date = String(value ?? '').slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}

export const memoryReportsBundle = {
  async getReportFilters(actor) {
    const campus = this.campuses.find((item) =>
      item.id === actor.activeCampusId && item.organizationId === actor.orgId);
    if (!campus) throw forbiddenReport();
    const visibleSections = await this.accessibleSectionIds(actor);
    const allYears = this.academicYears.filter((item) => item.campusId === actor.activeCampusId);
    const allGrades = this.gradeLevels.filter((item) => item.campusId === actor.activeCampusId);
    const yearIds = new Set(allYears.map((item) => item.id));
    const gradeIds = new Set(allGrades.map((item) => item.id));
    const sections = this.sections.filter((item) =>
      item.campusId === actor.activeCampusId && yearIds.has(item.academicYearId) &&
      gradeIds.has(item.gradeLevelId) && (!visibleSections || visibleSections.has(item.id)));
    const visibleYearIds = new Set(sections.map((item) => item.academicYearId));
    const visibleGradeIds = new Set(sections.map((item) => item.gradeLevelId));
    const years = allYears.filter((item) => !visibleSections || visibleYearIds.has(item.id));
    const grades = allGrades.filter((item) => !visibleSections || visibleGradeIds.has(item.id));
    return {
      years: years.map((item) => ({ id: item.id, label: item.labelEc })),
      terms: years.flatMap((year) => (year.terms ?? []).map((term) => ({
        id: term.id, yearId: year.id, label: term.name
      }))),
      grades: grades.map((item) => ({ id: item.id, label: item.nameEn })),
      sections: sections.map((item) => ({
        id: item.id, yearId: item.academicYearId, gradeId: item.gradeLevelId, label: item.name
      }))
    };
  },
  async getReport(reportId, filters, actor, { exportCsv = false } = {}) {
    const definition = reportCatalog.find((item) => item.id === reportId);
    const permissions = await this.getRolePermissions(actor.orgId, actor.role);
    if (!definition || !definition.roleScope.includes(actor.role) ||
        !permissions.includes(definition.permission)) throw forbiddenReport();

    const campus = this.campuses.find((item) =>
      item.id === actor.activeCampusId && item.organizationId === actor.orgId);
    if (!campus) throw forbiddenReport();
    const academicYear = filters.year
      ? this.academicYears.find((item) =>
        item.id === filters.year && item.campusId === actor.activeCampusId)
      : await this.getAcademicYear(actor.activeCampusId);
    if (filters.year && !academicYear) return reportPage(definition, [], filters.page, filters.pageSize);
    const { from, to } = reportDateRange(filters, academicYear, addisDate());
    const visibleSections = await this.accessibleSectionIds(actor);
    const sections = this.sections.filter((section) =>
      section.campusId === actor.activeCampusId &&
      (!visibleSections || visibleSections.has(section.id)) &&
      (!filters.section || section.id === filters.section) &&
      (!filters.grade || section.gradeLevelId === filters.grade) &&
      (!academicYear || section.academicYearId === academicYear.id));
    const sectionIds = new Set(sections.map((section) => section.id));
    const gradeName = (id) => this.gradeLevels.find((grade) =>
      grade.id === id && grade.campusId === actor.activeCampusId)?.nameEn ?? '';

    let rows = [];
    if (reportId === 'inventory-stock-valuation') {
      this.initInventory?.();
      rows = (this.inventoryItems ?? []).filter((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.status === 'active' && !item.archivedAt).map((item) => {
        const category = (this.inventoryCategories ?? []).find((row) =>
          row.id === item.categoryId && row.organizationId === actor.orgId &&
          row.campusId === actor.activeCampusId);
        const value = BigInt(item.currentQuantity) * BigInt(item.averageUnitCostMinor);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Inventory stock valuation exceeds safe integer precision.');
        }
        return { sku: item.sku, item: item.name, category: category?.name ?? '',
          quantity: item.currentQuantity, unit: item.unit,
          averageUnitCostMinor: item.averageUnitCostMinor, stockValueMinor: Number(value),
          currencyCode: item.currencyCode, reorderLevel: item.reorderLevel };
      });
    } else if (reportId === 'inventory-movements') {
      this.initInventory?.();
      rows = (this.inventoryMovements ?? []).filter((movement) =>
        movement.organizationId === actor.orgId && movement.campusId === actor.activeCampusId &&
        dateInRange(movement.movedOn, from, to)).map((movement) => {
        const item = (this.inventoryItems ?? []).find((row) => row.id === movement.itemId &&
          row.organizationId === actor.orgId && row.campusId === actor.activeCampusId);
        return item ? { date: movement.movedOn, sku: item.sku, item: item.name,
          movementType: movement.movementType, quantityDelta: movement.quantityDelta,
          quantityAfter: movement.quantityAfter, unitCostMinor: movement.unitCostMinor,
          totalCostMinor: movement.totalCostMinor, reason: movement.reason } : null;
      }).filter(Boolean);
    } else if (reportId === 'inventory-assets') {
      this.initInventory?.();
      rows = (this.fixedAssets ?? []).filter((asset) =>
        asset.organizationId === actor.orgId && asset.campusId === actor.activeCampusId &&
        !asset.archivedAt).map((asset) => {
        const allocation = (this.assetAllocations ?? []).find((row) =>
          row.assetId === asset.id && row.organizationId === actor.orgId &&
          row.campusId === actor.activeCampusId && row.status === 'active');
        const staff = allocation?.staffId && this.staff.find((row) =>
          row.id === allocation.staffId && row.organizationId === actor.orgId &&
          row.campusId === actor.activeCampusId);
        const room = allocation?.roomId && (this.rooms ?? []).find((row) =>
          row.id === allocation.roomId && row.campusId === actor.activeCampusId);
        return { assetTag: asset.assetTag, name: asset.name, category: asset.category,
          purchasedOn: asset.purchasedOn, purchaseCostMinor: asset.purchaseCostMinor,
          currencyCode: asset.currencyCode, condition: asset.condition, location: asset.location,
          status: asset.status, allocatedTo: staff
            ? [staff.givenNameEn, staff.fatherNameEn, staff.grandfatherNameEn].filter(Boolean).join(' ')
            : room?.name ?? '' };
      });
    } else if (reportId === 'library-inventory') {
      const books = this.libraryBooks.filter((book) =>
        book.organizationId === actor.orgId && book.campusId === actor.activeCampusId &&
        book.status === 'active' && !book.archivedAt);
      rows = books.map((book) => {
        const copies = (this.libraryCopies ?? []).filter((copy) =>
          copy.organizationId === actor.orgId && copy.campusId === actor.activeCampusId &&
          copy.bookId === book.id && !copy.archivedAt);
        const category = (this.libraryCategories ?? []).find((item) =>
          item.id === book.categoryId && item.organizationId === actor.orgId &&
          item.campusId === actor.activeCampusId);
        return {
          title: book.title, author: book.author, isbn: book.isbn ?? '',
          category: category?.name ?? '', totalCopies: copies.length,
          availableCopies: copies.filter((copy) => copy.status === 'available').length,
          borrowedCopies: copies.filter((copy) => copy.status === 'loaned').length,
          reservedCopies: copies.filter((copy) => copy.status === 'reserved').length,
          unavailableCopies: copies.filter((copy) => ['damaged', 'lost'].includes(copy.status)).length
        };
      });
    } else if (reportId === 'library-copies') {
      rows = (this.libraryCopies ?? []).filter((copy) =>
        copy.organizationId === actor.orgId && copy.campusId === actor.activeCampusId &&
        !copy.archivedAt).map((copy) => {
        const book = (this.libraryBooks ?? []).find((item) => item.id === copy.bookId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
        if (!book || book.archivedAt) return null;
        return {
          barcode: copy.barcode, copyNumber: copy.copyNumber, title: book.title,
          author: book.author, condition: copy.condition, shelfLocation: copy.shelfLocation,
          status: copy.status
        };
      }).filter(Boolean);
    } else if (reportId === 'library-circulation') {
      rows = (this.libraryLoans ?? []).filter((loan) =>
        loan.organizationId === actor.orgId && loan.campusId === actor.activeCampusId &&
        dateInRange(loan.issuedOn, from, to)).map((loan) => {
        const book = this.libraryBooks.find((item) => item.id === loan.bookId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
        const member = (this.libraryMembers ?? []).find((item) => item.id === loan.memberId &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
        const person = member?.memberType === 'student'
          ? this.students.find((item) => item.id === member.studentId)
          : this.staff.find((item) => item.id === member?.staffId);
        const fine = (this.libraryFines ?? []).find((item) => item.loanId === loan.id &&
          item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
        return {
          issuedOn: loan.issuedOn, dueOn: loan.dueOn, returnedOn: loan.returnedOn ?? '',
          title: book?.title ?? '', member: person
            ? [person.givenNameEn, person.fatherNameEn, person.grandfatherNameEn].filter(Boolean).join(' ')
            : '',
          status: loan.status, fineMinor: fine?.amountMinor ?? 0,
          currencyCode: fine?.currencyCode ?? ''
        };
      });
    } else if (reportId === 'hr-employees') {
      const byStatus = new Map();
      for (const staff of this.staff.filter((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        !item.archivedAt && item.hiredOn && dateInRange(item.hiredOn, from, to))) {
        byStatus.set(staff.employmentStatus, (byStatus.get(staff.employmentStatus) ?? 0) + 1);
      }
      rows = [...byStatus].map(([status, count]) => ({ status, count }));
    } else if (reportId === 'hr-leave') {
      rows = this.leaveRequests.filter((item) =>
        item.organizationId === actor.orgId && item.campusId === actor.activeCampusId &&
        item.startDate <= to && item.endDate >= from).map((item) => {
        const staff = this.staff.find((record) => record.id === item.staffId &&
          record.organizationId === actor.orgId && record.campusId === actor.activeCampusId);
        const type = this.hrLeaveTypes.find((record) => record.id === item.leaveTypeId &&
          record.organizationId === actor.orgId && record.campusId === actor.activeCampusId);
        return staff ? {
          staff: `${staff.givenNameEn} ${staff.fatherNameEn} ${staff.grandfatherNameEn}`.trim(),
          leaveType: type?.name ?? 'Unpaid', status: item.status,
          startDate: item.startDate, endDate: item.endDate,
          halfDays: item.requestedHalfDays ?? 0
        } : null;
      }).filter(Boolean);
    } else if (reportId === 'hr-staff-attendance') {
      rows = this.staffAttendance.filter((record) =>
        record.campusId === actor.activeCampusId && dateInRange(record.date, from, to))
        .map((record) => {
          const staff = this.staff.find((item) => item.id === record.staffId &&
            item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
          if (!staff) return null;
          return {
            staff: `${staff.givenNameEn} ${staff.fatherNameEn} ${staff.grandfatherNameEn}`.trim(),
            department: this.departments.find((item) => item.id === staff.departmentId)?.name ?? '',
            date: record.date, status: record.status,
            clockIn: record.clockIn ?? '', clockOut: record.clockOut ?? ''
          };
        }).filter(Boolean);
    } else if (reportId === 'student-directory') {
      rows = (await this.listStudentsFor(actor)).map((student) => {
        const enrollment = this.enrolments.find((item) => item.studentId === student.id &&
          item.status === 'active' && (!academicYear || item.academicYearId === academicYear.id) &&
          dateInRange(item.enrolledOn, from, to));
        const section = enrollment
          ? this.sections.find((item) => item.id === enrollment.sectionId && sectionIds.has(item.id))
          : sections.find((item) => item.name === student.sectionName);
        return sectionIds.has(section?.id) ? { student, section } : null;
      }).filter(Boolean).map(({ student, section }) => {
        return {
          studentNo: student.studentNo,
          name: `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`.trim(),
          grade: gradeName(section?.gradeLevelId), section: section?.name ?? '',
          gender: student.gender, status: student.status
        };
      });
    } else if (reportId === 'admissions-enrolment') {
      const admissions = this.admissions.filter((item) => item.campusId === actor.activeCampusId &&
        (!academicYear || item.academicYearId === academicYear.id) &&
        dateInRange(item.createdAt ?? item.submittedAt, from, to) &&
        (!filters.grade || item.gradeLevelId === filters.grade));
      const gradeIds = new Set([...sections.map((item) => item.gradeLevelId),
        ...admissions.map((item) => item.gradeLevelId)]);
      rows = aggregateReportRows(reportId, {
        grades: this.gradeLevels.filter((grade) =>
          grade.campusId === actor.activeCampusId && gradeIds.has(grade.id)),
        admissions, sections,
        enrolments: this.enrolments.filter((item) =>
          (!academicYear || item.academicYearId === academicYear.id) && sectionIds.has(item.sectionId))
      });
    } else if (reportId.startsWith('attendance-')) {
      const terms = academicYear?.terms ?? [];
      const term = filters.term ? terms.find((item) => item.id === filters.term) : null;
      if (filters.term && !term) return reportPage(definition, [], filters.page, filters.pageSize);
      const attendanceRows = [];
      for (const session of this.attendance) {
        if (session.campusId !== actor.activeCampusId || !sectionIds.has(session.sectionId) ||
            !dateInRange(session.date, from, to) ||
            (term && (session.date < term.startDate || session.date > term.endDate))) continue;
        const section = sections.find((item) => item.id === session.sectionId);
        for (const record of session.records ?? []) {
          const student = this.students.find((item) =>
            item.id === record.studentId && item.campusId === actor.activeCampusId);
          if (!student) continue;
          attendanceRows.push({
            date: session.date, sectionId: section.id, section: section.name,
            grade: gradeName(section.gradeLevelId), studentId: student.id,
            studentNo: student.studentNo,
            name: `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`.trim(),
            status: record.status
          });
        }
      }
      rows = aggregateReportRows(reportId, capRows(attendanceRows));
    } else if (['academic-pass-rates', 'subject-performance', 'class-comparison',
      'student-progress'].includes(reportId)) {
      const terms = academicYear?.terms ?? [];
      const term = filters.term
        ? terms.find((item) => item.id === filters.term)
        : null;
      if (filters.term && !term) return reportPage(definition, [], filters.page, filters.pageSize);
      const marks = this.marks.filter((mark) => mark.campusId === actor.activeCampusId &&
        mark.state === 'locked' && mark.termId &&
        (!filters.term || mark.termId === filters.term));
      const source = marks.flatMap((mark) => {
        const student = this.students.find((item) =>
          item.id === mark.studentId && item.campusId === actor.activeCampusId);
        const section = student && sections.find((item) => item.name === student.sectionName);
        const subject = this.subjects.find((item) =>
          item.id === mark.subjectId && item.campusId === actor.activeCampusId);
        const markTerm = this.academicYears.flatMap((year) => year.terms ?? [])
          .find((item) => item.id === mark.termId);
        if (!student || !section || !subject || !markTerm ||
            (term && term.id !== markTerm.id) ||
            !dateInRange(markTerm.startDate, from, to)) return [];
        return [{
          studentId: student.id, studentNo: student.studentNo,
          name: `${student.givenNameEn} ${student.fatherNameEn} ${student.grandfatherNameEn}`.trim(),
          grade: gradeName(section.gradeLevelId), section: section.name,
          term: markTerm.name, subject: subject.nameEn,
          value: mark.value, maxValue: mark.maxValue,
          score: Number(mark.maxValue) ? Math.round((Number(mark.value) / Number(mark.maxValue)) * 10000) / 100 : 0
        }];
      });
      rows = reportId === 'student-progress' ? capRows(source) : aggregateReportRows(reportId, capRows(source));
    } else if (reportId === 'finance-collection') {
      const source = await this.getFeeReport('details', from, to, actor);
      rows = aggregateReportRows(reportId, source.filter((item) =>
        (!filters.grade && !filters.section) || sections.some((section) =>
          section.name === item.className)));
    } else if (reportId === 'finance-arrears') {
      const source = await this.getArrearsReport(to, actor);
      rows = aggregateReportRows(reportId, source.filter((item) =>
        (!filters.grade && !filters.section) || sections.some((section) =>
          section.id === item.sectionId)));
    } else if (['my-classes', 'syllabus-coverage', 'teacher-workload'].includes(reportId)) {
      const assignments = (await this.listTeachingAssignments(actor)).filter((assignment) =>
        sectionIds.has(assignment.sectionId));
      if (reportId === 'my-classes') {
        rows = assignments.map((assignment) => {
          const section = sections.find((item) => item.id === assignment.sectionId);
          const year = this.academicYears.find((item) => item.id === section?.academicYearId);
          return {
            grade: gradeName(section?.gradeLevelId), section: section?.name ?? '',
            subject: assignment.subjectName, academicYear: year?.labelEc ?? ''
          };
        });
      } else if (reportId === 'teacher-workload') {
        rows = aggregateTeacherWorkload(assignments, filters.workloadLimit ?? 25);
      } else {
        const subjectsByClass = new Map();
        for (const assignment of assignments) {
          const section = sections.find((item) => item.id === assignment.sectionId);
          if (!section) continue;
          const key = `${assignment.sectionId}:${assignment.subjectId}`;
          const subject = subjectsByClass.get(key) ?? { assignment, assignmentIds: new Set() };
          subject.assignmentIds.add(assignment.id);
          subjectsByClass.set(key, subject);
        }
        rows = [...subjectsByClass.values()].map(({ assignment, assignmentIds }) => {
          const section = sections.find((item) => item.id === assignment.sectionId);
          const units = this.curriculumUnits.filter((unit) =>
            unit.campusId === actor.activeCampusId &&
            unit.academicYearId === section.academicYearId &&
            unit.gradeLevelId === section.gradeLevelId &&
            unit.subjectId === assignment.subjectId &&
            (unit.stream === 'all' || unit.stream === (section.stream ?? 'all')));
          const unitIds = new Set(units.map((unit) => unit.id));
          const coveredIds = new Set(this.lessonPlans.filter((plan) =>
            plan.campusId === actor.activeCampusId &&
            assignmentIds.has(plan.teachingAssignmentId) &&
            plan.status === 'completed' && plan.curriculumUnitId &&
            unitIds.has(plan.curriculumUnitId) && dateInRange(plan.plannedOn, from, to))
            .map((plan) => plan.curriculumUnitId));
          return {
            grade: gradeName(section.gradeLevelId), section: section.name,
            subject: assignment.subjectName, units: units.length, coveredUnits: coveredIds.size,
            coveragePercent: syllabusCoveragePercent(coveredIds.size, units.length)
          };
        });
      }
    } else if (['payroll-monthly', 'payroll-department-expense', 'payroll-deductions']
      .includes(reportId)) {
      const periods = new Map(this.payrollPeriods.filter((period) =>
        period.organizationId === actor.orgId && period.campusId === actor.activeCampusId &&
        dateInRange(period.startsOn, from, to)).map((period) => [period.id, period]));
      const runs = this.payrollRuns.filter((run) =>
        run.organizationId === actor.orgId && run.campusId === actor.activeCampusId &&
        ['locked', 'closed'].includes(run.status) && periods.has(run.periodId));
      const runById = new Map(runs.map((run) => [run.id, run]));
      const source = this.payrollLines.filter((line) => runById.has(line.runId) &&
        line.organizationId === actor.orgId && line.campusId === actor.activeCampusId);
      if (reportId === 'payroll-monthly') {
        rows = runs.map((run) => {
          const period = periods.get(run.periodId);
          const lines = source.filter((line) => line.runId === run.id);
          return {
            period: period.code, status: run.status, currencyCode: period.currencyCode,
            staffCount: lines.length,
            grossMinor: lines.reduce((sum, line) => sum + line.grossMinor, 0),
            netMinor: lines.reduce((sum, line) => sum + line.netMinor, 0)
          };
        });
      } else if (reportId === 'payroll-department-expense') {
        const grouped = new Map();
        for (const line of source) {
          const staff = this.staff.find((item) => item.id === line.staffId &&
            item.organizationId === actor.orgId && item.campusId === actor.activeCampusId);
          const department = this.departments.find((item) =>
            item.id === staff?.departmentId && item.campusId === actor.activeCampusId);
          const key = `${department?.id ?? 'unassigned'}:${line.currencyCode}`;
          const row = grouped.get(key) ?? {
            department: department?.name ?? 'Unassigned',
            currencyCode: line.currencyCode, staffCount: 0, grossMinor: 0
          };
          row.staffCount++;
          row.grossMinor += line.grossMinor;
          grouped.set(key, row);
        }
        rows = [...grouped.values()];
      } else {
        const grouped = new Map();
        for (const line of source) {
          for (const [deductionType, amountMinor] of [
            ['unpaid_leave', line.unpaidLeaveDeductionMinor],
            ['tax', line.taxMinor], ['pension', line.pensionMinor],
            ['other', line.otherDeductionsMinor]
          ]) {
            const key = `${deductionType}:${line.currencyCode}`;
            const row = grouped.get(key) ?? { deductionType,
              currencyCode: line.currencyCode, amountMinor: 0 };
            row.amountMinor += amountMinor;
            grouped.set(key, row);
          }
        }
        rows = [...grouped.values()];
      }
    }

    rows = capRows(rows);
    const result = reportPage(definition, rows,
      exportCsv ? 1 : filters.page, exportCsv ? Math.max(rows.length, 1) : filters.pageSize, exportCsv);
    result.summary = summarizeReport(reportId, rows);
    if (exportCsv) {
      await this.appendAudit(actor, 'report.exported', 'report', reportId, null, {
        filters, rowCount: rows.length
      });
    }
    return result;
  }
};
