import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import ReportsPage from './ReportsPage';

vi.mock('../../api', () => ({
  api: {
    reportsCatalog: vi.fn(),
    reportFilters: vi.fn(),
    report: vi.fn(),
    exportReport: vi.fn()
  }
}));

const report = {
  id: 'student-directory', category: 'students', permission: 'reports.students.view',
  roleScope: ['principal'], columns: ['studentNo', 'name'], filters: ['year'],
  csvExport: true, printView: true, pageSize: 50, maxPageSize: 100
};
const result = {
  report: 'student-directory', columns: ['studentNo', 'name'],
  rows: [{ studentNo: 'SIMS-1', name: 'Student One' }], summary: { records: 1 },
  page: 1, pageSize: 50, total: 1, hasMore: false
};

afterEach(() => vi.restoreAllMocks());

describe('ReportsPage', () => {
  it('loads the authorized catalog, report data, and updates filters', async () => {
    vi.mocked(api.reportsCatalog).mockResolvedValue([report]);
    vi.mocked(api.reportFilters).mockResolvedValue({
      years: [{ id: 'year-1', label: '2026 E.C.' }], terms: [], grades: [], sections: []
    });
    vi.mocked(api.report).mockResolvedValue(result);

    render(<ReportsPage t={(key) => key} />);

    expect(await screen.findByText('Student One')).toBeTruthy();
    expect(screen.getByText('reportRecordCount: 1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('academicYear'), { target: { value: 'year-1' } });
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith('student-directory',
      expect.objectContaining({ year: 'year-1', page: 1 })));
  });

  it('provides a print action for the report view', async () => {
    vi.mocked(api.reportsCatalog).mockResolvedValue([report]);
    vi.mocked(api.reportFilters).mockResolvedValue({
      years: [], terms: [], grades: [], sections: []
    });
    vi.mocked(api.report).mockResolvedValue(result);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(<ReportsPage t={(key) => key} />);
    fireEvent.click(await screen.findByRole('button', { name: 'printReport' }));

    expect(print).toHaveBeenCalledOnce();
  });

  it('opens a requested report page and passes the workload warning limit', async () => {
    const workloadReport = {
      ...report, id: 'teacher-workload', columns: ['teacher', 'periods', 'limit', 'warning']
    };
    vi.mocked(api.reportsCatalog).mockResolvedValue([workloadReport]);
    vi.mocked(api.reportFilters).mockResolvedValue({
      years: [], terms: [], grades: [], sections: []
    });
    vi.mocked(api.report).mockResolvedValue({
      ...result, report: 'teacher-workload', columns: workloadReport.columns, rows: []
    });

    render(<ReportsPage t={(key) => key} initialReportId="teacher-workload" />);
    fireEvent.change(await screen.findByLabelText('workloadLimit'), {
      target: { value: '30' }
    });

    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith('teacher-workload',
      expect.objectContaining({ workloadLimit: 30, page: 1 })));
  });
});
