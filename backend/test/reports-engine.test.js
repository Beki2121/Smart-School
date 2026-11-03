import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reportCatalog, reportPage, reportsForPermissions } from '../src/reports/catalog.js';
import {
  aggregateTeacherWorkload, syllabusCoveragePercent
} from '../src/reports/aggregate.js';
import { toCsv } from '../src/utils/csv.js';

describe('shared report engine', () => {
  it('provides one catalog shape with common filters, CSV, and print support', () => {
    assert.ok(reportCatalog.length >= 10);
    for (const report of reportCatalog) {
      assert.ok(report.id);
      assert.ok(report.category);
      assert.deepEqual(report.filters, ['year', 'term', 'grade', 'section', 'from', 'to']);
      assert.ok(report.columns.length);
      assert.ok(report.roleScope.length);
      assert.equal(report.csvExport, true);
      assert.equal(report.printView, true);
    }
  });

  it('returns only reports granted by their category permission', () => {
    assert.deepEqual(reportsForPermissions(['reports.admissions.view'])
      .map((report) => report.id), ['admissions-enrolment']);
  });

  it('paginates report rows and rejects invalid pagination', () => {
    const definition = reportCatalog[0];
    assert.deepEqual(reportPage(definition, [1, 2, 3], 2, 2), {
      report: definition.id, columns: definition.columns, rows: [3],
      summary: {},
      page: 2, pageSize: 2, total: 3, hasMore: false
    });
    assert.throws(() => reportPage(definition, [], 0, 10), {
      code: 'REPORT_PAGINATION_INVALID'
    });
  });

  it('quotes CSV and neutralizes formula-leading cells', () => {
    assert.equal(toCsv([['=1+1', ' +2', '-3', '@SUM(A1)', 'safe,"text"']]),
      `'=1+1,' +2,'-3,'@SUM(A1),"safe,""text"""`);
  });

  it('calculates syllabus coverage and flags teacher workload against a chosen limit', () => {
    assert.equal(syllabusCoveragePercent(3, 4), 75);
    assert.equal(syllabusCoveragePercent(0, 0), 0);
    assert.deepEqual(aggregateTeacherWorkload([
      { staffId: 'teacher-1', staffName: 'Teacher One', sectionId: 'class-a', periodNumber: 1 },
      { staffId: 'teacher-1', staffName: 'Teacher One', sectionId: 'class-a', periodNumber: 2 },
      { staffId: 'teacher-1', staffName: 'Teacher One', sectionId: 'class-b', periodNumber: null }
    ], 1), [{
      teacher: 'Teacher One', classes: 2, periods: 2, limit: 1, warning: true
    }]);
  });
});
