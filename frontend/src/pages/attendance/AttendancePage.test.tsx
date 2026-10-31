import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttendancePage from './AttendancePage';

vi.mock('../../api', () => ({
  api: {
    attendance: () => Promise.resolve([]),
    sections: () => Promise.resolve([]),
    attendanceSummary: () => Promise.resolve({
      from: '2026-10-01', to: '2026-10-30',
      totals: {
        attendanceRate: null, sessions: 0, records: 0, present: 0,
        absent: 0, late: 0, excused: 0
      },
      bySection: [], byDate: []
    })
  },
  queueOfflineOperation: () => Promise.resolve()
}));

afterEach(() => cleanup());

describe('attendance page', () => {
  it('renders attendance capture and the campus summary', async () => {
    render(
      <AttendancePage
        t={(key) => key}
        onQueued={async () => {}}
        ownerId="owner-1"
        canEditAttendance={false}
        canReviewCorrections={false}
      />
    );

    expect(await screen.findByRole('heading', { name: 'attendanceTitle' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'attendanceSummary' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /saveAttendance/ }).hasAttribute('disabled')).toBe(true);
  });
});
