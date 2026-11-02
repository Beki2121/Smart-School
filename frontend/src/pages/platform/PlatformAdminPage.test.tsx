import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import PlatformAdminPage from './PlatformAdminPage';

vi.mock('../../api', () => ({
  api: {
    platformDashboard: () => Promise.resolve({
    database: { reachable: true, checkedAt: '' },
    totals: {
      schools: 0, pending: 0, active: 0, suspended: 0, students: 0, staff: 0,
      activeSubscriptions: 0, trialingSubscriptions: 0, expiringSubscriptions: 0,
      revenueCollected: 0, currentMonthRevenue: 0, outstanding: 0, refunds: 0,
      netRevenue: 0, storageUsedBytes: 0
    },
    storageBySchool: [], schools: [], plans: []
    }),
    closureRequests: () => Promise.resolve([]),
    createPlatformSchool: vi.fn(),
    regenerateSchoolAdministratorInvitation: vi.fn(),
    platformUsers: vi.fn(),
    invitePlatformUser: vi.fn(),
    updatePlatformUser: vi.fn(),
    setPlatformUserActive: vi.fn(),
    assignPlatformRole: vi.fn()
  }
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('platform administration page', () => {
  it('renders the platform console and empty tenant state', async () => {
    render(
      <MemoryRouter>
        <PlatformAdminPage
          t={(key) => key}
          user={{
            id: 'admin-1', name: 'Platform Admin', role: 'system_admin',
            campusIds: [], activeCampusId: ''
          }}
          onLogout={async () => {}}
        />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'platformAdmin' })).toBeTruthy();
    expect(await screen.findByText('noSchools')).toBeTruthy();
  });

  it('provisions a school and displays its one-time administrator invitation link', async () => {
    vi.mocked(api.createPlatformSchool).mockResolvedValue({
      organizationId: 'org-1', status: 'active', trialEndsAt: '2027-01-01T00:00:00.000Z',
      invitation: {
        id: 'invite-1', email: 'owner@example.test', role: 'owner_director',
        name: 'School Owner', expiresAt: '2026-11-03T00:00:00.000Z'
      },
      invitationUrl: 'https://example.test/invite/one-time'
    });
    render(
      <MemoryRouter>
        <PlatformAdminPage
          t={(key) => key}
          user={{
            id: 'admin-1', name: 'Platform Admin', role: 'system_admin',
            campusIds: [], activeCampusId: ''
          }}
          onLogout={async () => {}}
        />
      </MemoryRouter>
    );

    await screen.findByRole('heading', { name: 'platformAdmin' });
    fireEvent.change(screen.getAllByLabelText('schoolName')[0], { target: { value: 'Example School' } });
    fireEvent.change(screen.getByLabelText('ownerName'), { target: { value: 'School Owner' } });
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'owner@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'provisionSchool' }));

    await waitFor(() => expect(api.createPlatformSchool).toHaveBeenCalledWith(expect.objectContaining({
      schoolName: 'Example School', ownerName: 'School Owner', ownerEmail: 'owner@example.test'
    })));
    expect(await screen.findByDisplayValue('https://example.test/invite/one-time')).toBeTruthy();
  });

  it('lists, invites, edits, assigns and deactivates platform administrators', async () => {
    const user = {
      id: 'platform-user-1', name: 'Platform User', email: 'platform@example.test',
      role: 'super_admin', isActive: true, campusIds: []
    };
    vi.mocked(api.platformUsers).mockResolvedValue([user]);
    vi.mocked(api.invitePlatformUser).mockResolvedValue({
      id: 'invite-2', name: 'New Platform User', email: 'new-platform@example.test',
      role: 'super_admin', expiresAt: '', invitationUrl: 'https://example.test/invite/platform'
    });
    vi.mocked(api.updatePlatformUser).mockResolvedValue({ ...user, name: 'Edited User' });
    vi.mocked(api.assignPlatformRole).mockResolvedValue(user);
    vi.mocked(api.setPlatformUserActive).mockResolvedValue({ ...user, isActive: false });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/#platform-users']}>
        <PlatformAdminPage t={(key) => key}
          user={{ id: 'admin-1', name: 'Platform Admin', role: 'super_admin',
            campusIds: [], activeCampusId: '' }}
          onLogout={async () => {}} />
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue('platform@example.test')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('platformUserEmail'), {
      target: { value: 'new-platform@example.test' }
    });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'New Platform User' } });
    fireEvent.click(screen.getByRole('button', { name: 'invitePlatformUser' }));
    await waitFor(() => expect(api.invitePlatformUser).toHaveBeenCalledWith(
      'New Platform User', 'new-platform@example.test'
    ));

    fireEvent.click(screen.getByRole('button', { name: 'assignRole' }));
    await waitFor(() => expect(api.assignPlatformRole).toHaveBeenCalledWith(
      user.id, 'super_admin'
    ));
    fireEvent.change(screen.getByLabelText('name platform@example.test'), {
      target: { value: 'Edited User' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'updatePlatformUser' }));
    await waitFor(() => expect(api.updatePlatformUser).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'deactivatePlatformUser' }));
    await waitFor(() => expect(api.setPlatformUserActive).toHaveBeenCalledWith(
      user.id, false
    ));
  }, 15_000);
});
