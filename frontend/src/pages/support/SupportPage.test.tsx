import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import SupportPage from './SupportPage';

vi.mock('../../api', () => ({
  api: {
    supportTickets: vi.fn(),
    createSupportTicket: vi.fn(),
    getSupportTicket: vi.fn(),
    uploadSupportAttachment: vi.fn(),
    emailIntegrationStatus: vi.fn(),
    platformMonitoring: vi.fn()
  }
}));

const ticket = {
  id: 'ticket-1', organizationId: 'org-1', campusId: 'campus-1',
  ticketType: 'platform' as const, subject: 'Cannot sign in', category: 'account',
  priority: 'high' as const, status: 'open' as const, createdBy: 'user-1',
  assignedTo: null, resolvedAt: null, createdAt: '2026-11-04T10:00:00Z',
  updatedAt: '2026-11-04T10:00:00Z', comments: [], attachments: []
};
const t = (key: string) => key;

describe('SupportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.supportTickets).mockResolvedValue([]);
    vi.mocked(api.createSupportTicket).mockResolvedValue(ticket);
    vi.mocked(api.getSupportTicket).mockResolvedValue(ticket);
  });

  it('creates a school support ticket and shows the submitted ticket detail', async () => {
    render(<SupportPage t={t} permissions={['support.tickets.view', 'support.tickets.create']}
      userId="user-1" />);
    fireEvent.change(screen.getByLabelText('supportSubject'), { target: { value: 'Cannot sign in' } });
    fireEvent.click(screen.getByRole('button', { name: 'supportCreate' }));
    await waitFor(() => expect(api.createSupportTicket).toHaveBeenCalledWith('customer', {
      subject: 'Cannot sign in', category: 'technical', priority: 'normal'
    }));
    expect(await screen.findByText('supportCreated')).toBeTruthy();
  });

  it('shows monitoring only when the platform monitoring permission is present', async () => {
    render(<SupportPage t={t} permissions={['support.platform.view', 'platform.monitor.view']}
      userId="platform-user" />);
    expect(await screen.findByText('platformMonitoring')).toBeTruthy();
    expect(api.platformMonitoring).toHaveBeenCalledOnce();
    expect(api.supportTickets).toHaveBeenCalledWith('platform', {
      search: '', status: '', priority: '', page: 1, pageSize: 50
    });
  });
});
