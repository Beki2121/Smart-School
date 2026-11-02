import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveSession, AuditPage, api } from '../../api';
import AuditLogPage from './AuditLogPage';

vi.mock('../../api', () => ({
  api: {
    loginHistory: vi.fn(),
    activeSessions: vi.fn(),
    revokeSession: vi.fn()
  }
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('audit and login history', () => {
  it('signs out after revoking the current session', async () => {
    const page: AuditPage = { events: [], total: 0, page: 1, pageSize: 25 };
    const session: ActiveSession = {
      sessionId: 'session-current', userId: 'owner-1', name: 'School Owner',
      email: 'owner@example.test', role: 'owner_director', campusName: 'Main Branch',
      ipAddress: '127.0.0.1', userAgent: 'test browser',
      createdAt: '2026-11-02T10:00:00.000Z',
      lastSeenAt: '2026-11-02T10:00:00.000Z',
      expiresAt: '2026-11-03T10:00:00.000Z'
    };
    vi.mocked(api.loginHistory).mockResolvedValue(page);
    vi.mocked(api.activeSessions).mockResolvedValue([session]);
    vi.mocked(api.revokeSession).mockResolvedValue(undefined);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const onCurrentSessionRevoked = vi.fn();

    render(<AuditLogPage t={(key) => key} history currentSessionId="session-current"
      onCurrentSessionRevoked={onCurrentSessionRevoked} />);

    expect(await screen.findByText('owner@example.test')).toBeTruthy();
    screen.getByRole('button', { name: 'revokeSession' }).click();
    await vi.waitFor(() => expect(api.revokeSession).toHaveBeenCalledWith('session-current'));
    expect(onCurrentSessionRevoked).toHaveBeenCalledOnce();
  });
});
