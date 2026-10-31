import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import PlatformAdminPage from './PlatformAdminPage';

vi.mock('../../api', () => ({
  api: {
    platformDashboard: () => Promise.resolve({
      totals: { schools: 0, pending: 0, active: 0, students: 0 },
      schools: [], plans: []
    }),
    closureRequests: () => Promise.resolve([])
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
    expect(screen.getByText('noSchools')).toBeTruthy();
  });
});
