import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import PlatformAdminPage from './PlatformAdminPage';

vi.mock('../../api', () => ({
  api: {
    platformDashboard: () => Promise.resolve({
      totals: { schools: 0, pending: 0, active: 0, students: 0 },
      schools: [], plans: []
    }),
    closureRequests: () => Promise.resolve([]),
    createPlatformSchool: vi.fn(),
    regenerateSchoolAdministratorInvitation: vi.fn()
  }
}));

afterEach(() => cleanup());

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
});
