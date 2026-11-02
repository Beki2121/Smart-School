import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { SchoolAccountsPage, StaffPage } from './StaffPages';

vi.mock('../../api', () => ({
  api: {
    accounts: vi.fn(() => Promise.resolve([])),
    roles: vi.fn(() => Promise.resolve({ roles: [], permissions: [] })),
    setAccountActive: vi.fn(),
    assignAccountRole: vi.fn(),
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
beforeEach(() => vi.clearAllMocks());

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

  it('lets a principal choose only the approved branch staff roles', async () => {
    render(
      <StaffPage
        t={(key) => key}
        canManage
        canInviteStaff
        canManageAssignments={false}
        user={{ ...user, id: 'principal-1', name: 'Principal', role: 'principal' }}
      />
    );

    const roleSelect = await screen.findByLabelText('accountRole');
    expect(within(roleSelect).getByRole('option', { name: 'role_registrar' })).toBeTruthy();
    expect(within(roleSelect).getByRole('option', { name: 'role_hr_admin' })).toBeTruthy();
    expect(within(roleSelect).queryByRole('option', { name: 'role_system_admin' })).toBeNull();
    expect(within(roleSelect).queryByRole('option', { name: 'role_owner_director' })).toBeNull();
  });

  it('disables deactivation and demotion of the last active school administrator', async () => {
    const lastAdministrator = {
      id: 'owner-1', name: 'School Administrator', email: 'owner@example.test',
      role: 'owner_director', isActive: true, campusIds: ['campus-1']
    };
    vi.mocked(api.accounts).mockResolvedValue([lastAdministrator]);
    vi.mocked(api.roles).mockResolvedValue({
      roles: [{
        id: 'owner-role', organizationId: null, key: 'owner_director',
        name: 'School Administrator', isSystem: true, permissions: ['accounts.manage']
      }],
      permissions: []
    });

    render(<SchoolAccountsPage
      t={(key) => key}
      user={{ id: 'principal-1', name: 'Principal', role: 'principal',
        campusIds: ['campus-1'], activeCampusId: 'campus-1' }} />);

    expect(await screen.findByText('lastSchoolAdministratorNotice')).toBeTruthy();
    const accountRow = screen.getByText('School Administrator').closest('article');
    expect(accountRow).toBeTruthy();
    const row = within(accountRow as HTMLElement);
    const roleSelect = row.getByRole('combobox');
    const deactivateButton = row.getByRole('button', { name: 'deactivateAccount' });
    expect((roleSelect as HTMLSelectElement).disabled).toBe(true);
    expect((deactivateButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(deactivateButton);
    fireEvent.change(roleSelect, { target: { value: 'principal' } });
    await waitFor(() => {
      expect(api.setAccountActive).not.toHaveBeenCalled();
      expect(api.assignAccountRole).not.toHaveBeenCalled();
    });
  });
});
