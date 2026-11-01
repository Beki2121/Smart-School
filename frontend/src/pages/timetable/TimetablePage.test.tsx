import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TimetablePage from './TimetablePage';

vi.mock('../../api', () => ({
  api: {
    sections: () => Promise.resolve([]),
    staff: () => Promise.resolve([]),
    timetablePeriods: () => Promise.resolve([]),
    rooms: () => Promise.resolve([]),
    leaveRequests: () => Promise.resolve([]),
    timetable: () => Promise.resolve([])
  }
}));

afterEach(() => cleanup());

describe('timetable page', () => {
  it('shows the timetable to read-only users without setup forms', async () => {
    render(
      <TimetablePage
        t={(key) => key}
        canManage={false}
        canManageLessons={false}
      />
    );

    expect(await screen.findByRole('heading', { name: 'timetable' })).toBeTruthy();
    expect(screen.getByText('configurePeriods')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'timetableSetup' })).toBeNull();
  });
});
