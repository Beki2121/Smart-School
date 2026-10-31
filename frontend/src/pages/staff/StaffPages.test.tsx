import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchoolAccountsPage, StaffPage } from './StaffPages';

vi.mock('../../api', () => ({
  api: {
    accounts: () => Promise.resolve([]),
    staff: () => Promise.resolve([]),
    departments: () => Promise.resolve([]),
    sections: () => Promise.resolve([]),
    subjects: () => Promise.resolve([]),
    timetablePeriods: () => Promise.resolve([]),
    rooms: () => Promise.resolve([]),
    teachingAssignments: () => Promise.resolve([]),
    staffAttendance: () => Promise.resolve([]),
    leaveRequests: () => Promise.resolve([]),
    staffMessages: () => Promise.resolve([])
  }
}));

afterEach(() => cleanup());

const user = {
  id: 'registrar-1', name: 'School Registrar', role: 'registrar',
  campusIds: ['campus-1'], activeCampusId: 'campus-1'
};

describe('staff and account pages', () => {
  it('renders staff records without manager controls for a read-only role', async () => {
    render(
      <StaffPage
        t={(key) => key}
        canManage={false}
        canInviteStaff={false}
        canManageAssignments={false}
        user={user}
      />
    );

    expect(await screen.findByRole('heading', { name: 'staffManagement' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'addDepartment' })).toBeNull();
  });

  it('limits registrar invitation role choices to permitted roles', async () => {
    render(<SchoolAccountsPage t={(key) => key} user={user} />);

    expect(await screen.findByRole('heading', { name: 'accounts' })).toBeTruthy();
    const roleSelect = screen.getByLabelText('accountRole');
    expect(within(roleSelect).getByRole('option', { name: 'role_homeroom_teacher' })).toBeTruthy();
    expect(within(roleSelect).getByRole('option', { name: 'role_subject_teacher' })).toBeTruthy();
    expect(within(roleSelect).getByRole('option', { name: 'role_counsellor' })).toBeTruthy();
    expect(within(roleSelect).queryByRole('option', { name: 'role_accountant_cashier' })).toBeNull();
  });
});
