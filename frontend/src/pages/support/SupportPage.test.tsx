import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import SupportPage from './SupportPage';

vi.mock('../../api', () => ({
  api: {
    supportTickets: vi.fn(),
    supportAssignees: vi.fn(),
    createSupportTicket: vi.fn(),
    getSupportTicket: vi.fn(),
    updateSupportTicket: vi.fn(),
    uploadSupportAttachment: vi.fn(),
    emailIntegrationStatus: vi.fn(),
    requestEmailVerification: vi.fn(),
    confirmEmailVerification: vi.fn(),
    sendIntegrationTestEmail: vi.fn(),
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
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.supportTickets).mockResolvedValue([]);
    vi.mocked(api.supportAssignees).mockResolvedValue([]);
    vi.mocked(api.createSupportTicket).mockResolvedValue(ticket);
    vi.mocked(api.getSupportTicket).mockResolvedValue(ticket);
    vi.mocked(api.updateSupportTicket).mockResolvedValue({ ...ticket, assignedTo: 'agent-2' });
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

  it('loads platform assignees and supports reassignment', async () => {
    vi.mocked(api.supportTickets).mockResolvedValue([ticket]);
    vi.mocked(api.supportAssignees).mockResolvedValue([
      { id: 'agent-2', name: 'Support Agent' }
    ]);
    render(<SupportPage t={t} permissions={['support.platform.view', 'support.platform.manage']}
      userId="platform-user" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cannot sign in' }));
    const assignee = await screen.findByLabelText('supportAssignee');
    expect(screen.getByRole('option', { name: 'Support Agent' })).toBeTruthy();
    fireEvent.change(assignee, { target: { value: 'agent-2' } });
    await waitFor(() => expect(api.updateSupportTicket).toHaveBeenCalledWith(
      'platform', 'ticket-1', { assignedTo: 'agent-2' }
    ));
  });

  it('requires account email verification before sending integration tests', async () => {
    vi.mocked(api.emailIntegrationStatus)
      .mockResolvedValueOnce({
        configured: true, fromAddress: 'school@example.test',
        emailAddress: 'staff@example.test', emailVerified: false, lastTestResult: null
      })
      .mockResolvedValueOnce({
        configured: true, fromAddress: 'school@example.test',
        emailAddress: 'staff@example.test', emailVerified: true,
        lastTestResult: { result: 'succeeded', testedAt: '2026-11-06T10:00:00Z', errorCode: null }
      });
    vi.mocked(api.requestEmailVerification).mockResolvedValue({ sent: true });
    vi.mocked(api.confirmEmailVerification).mockResolvedValue({ verified: true });
    vi.mocked(api.sendIntegrationTestEmail).mockResolvedValue({ sent: true });
    render(<SupportPage t={t} permissions={[
      'integrations.email.view', 'integrations.email.verify', 'integrations.email.test'
    ]} userId="school-user" />);
    await waitFor(() => expect(api.emailIntegrationStatus).toHaveBeenCalledOnce());
    const sendButton = screen.getByRole('button', { name: 'integrationSendTest' });
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'integrationVerifyEmail' }));
    fireEvent.change(await screen.findByLabelText('integrationVerificationCode'), {
      target: { value: 'a'.repeat(32) }
    });
    fireEvent.click(screen.getByRole('button', { name: 'integrationConfirmEmail' }));
    await waitFor(() => expect(api.confirmEmailVerification).toHaveBeenCalledWith('a'.repeat(32)));
    await waitFor(() => expect((sendButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton);
    await waitFor(() => expect(api.sendIntegrationTestEmail).toHaveBeenCalledOnce());
  });
});
