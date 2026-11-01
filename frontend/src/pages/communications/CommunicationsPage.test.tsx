import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommunicationsPage from './CommunicationsPage';

vi.mock('../../api', () => ({
  api: {
    campusAnnouncements: () => Promise.resolve([]),
    campusEvents: () => Promise.resolve([])
  }
}));

afterEach(() => cleanup());

describe('communications page', () => {
  it('shows announcements and events without publishing controls for a read-only role', async () => {
    render(
      <CommunicationsPage
        t={(key) => key}
        locale="en"
        canManage={false}
      />
    );

    expect(await screen.findByRole('heading', { name: 'communications' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'announcements' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'schoolEvents' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'publishAnnouncement' })).toBeNull();
  });
});
