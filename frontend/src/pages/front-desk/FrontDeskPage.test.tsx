import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../api';
import FrontDeskPage from './FrontDeskPage';

vi.mock('../../api', () => ({
  api: {
    frontDeskDashboard: vi.fn(),
    frontDeskVisitors: vi.fn(),
    createFrontDeskVisitor: vi.fn(),
    checkoutFrontDeskVisitor: vi.fn(),
    frontDeskAppointments: vi.fn(),
    createFrontDeskAppointment: vi.fn(),
    updateFrontDeskAppointmentStatus: vi.fn(),
    frontDeskMessages: vi.fn(),
    createFrontDeskMessage: vi.fn(),
    updateFrontDeskMessageStatus: vi.fn(),
    frontDeskAuthorizations: vi.fn(),
    createFrontDeskAuthorization: vi.fn(),
    updateFrontDeskAuthorizationStatus: vi.fn(),
    frontDeskPickupReleases: vi.fn(),
    frontDeskPickupAttempts: vi.fn(),
    releaseFrontDeskPickup: vi.fn(),
    correctFrontDeskPickup: vi.fn(),
    frontDeskDeliveries: vi.fn(),
    createFrontDeskDelivery: vi.fn(),
    updateFrontDeskDeliveryStatus: vi.fn(),
    frontDeskLostFound: vi.fn(),
    createFrontDeskLostFound: vi.fn(),
    updateFrontDeskLostFoundStatus: vi.fn()
  }
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FrontDeskPage', () => {
  it('lets teachers see only their own appointments and messages without management actions', async () => {
    vi.mocked(api.frontDeskAppointments).mockResolvedValue([{
      id: 'appointment-1', parentName: 'Parent', studentId: null, staffId: 'staff-1',
      appointmentAt: '2026-11-05T10:00:00', purpose: 'Meeting', status: 'scheduled'
    }]);
    vi.mocked(api.frontDeskMessages).mockResolvedValue([{
      id: 'message-1', senderName: 'Caller', recipientStaffId: 'staff-1',
      subject: 'Call back', message: 'Please call.', status: 'new', createdAt: '2026-11-05T09:00:00'
    }]);

    render(<MemoryRouter><FrontDeskPage t={(key) => key} permissions={[
      'frontdesk.appointments.self.view', 'frontdesk.messages.self.view'
    ]} /></MemoryRouter>);

    expect(await screen.findByText('Parent')).toBeTruthy();
    expect(screen.getByText('Meeting')).toBeTruthy();
    expect(screen.queryByText('frontDeskCreateAppointment')).toBeNull();
    expect(screen.queryByText('frontDeskCreateMessage')).toBeNull();
    expect(api.frontDeskVisitors).not.toHaveBeenCalled();
    expect(api.frontDeskPickupReleases).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api.frontDeskAppointments).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
      expect(api.frontDeskMessages).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
    });
  });

  it('shows the no-ID-number instruction alongside a pickup verification note', async () => {
    vi.mocked(api.frontDeskAuthorizations).mockResolvedValue([{
      id: 'authorization-1', studentId: 'student-1', guardianName: 'Guardian',
      relationship: 'Parent', phone: '', authorizationType: 'regular', oneTime: false,
      expiresAt: null, usedAt: null, status: 'active'
    }]);
    vi.mocked(api.frontDeskPickupReleases).mockResolvedValue([]);
    vi.mocked(api.frontDeskPickupAttempts).mockResolvedValue([]);

    render(<MemoryRouter><FrontDeskPage t={(key) => key} permissions={[
      'frontdesk.pickup.log.view', 'frontdesk.pickup.release',
      'frontdesk.pickup.authorizations.manage'
    ]} /></MemoryRouter>);

    expect(await screen.findByText('frontDeskVerifyPickup')).toBeTruthy();
    expect(screen.getByText('frontDeskNoIdNumbers')).toBeTruthy();
    expect(screen.getByRole('option', { name: /student-1 — Guardian/ })).toBeTruthy();
    expect(screen.getByText('frontDeskReleaseLog')).toBeTruthy();
  });

  it('checks in a visitor and offers checkout only for an active visit', async () => {
    vi.mocked(api.frontDeskVisitors)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'visitor-1', visitorName: 'Visitor One', purpose: 'Meeting', hostStaffId: null,
        status: 'checked_in', checkedInAt: '2026-11-05T10:00:00', checkedOutAt: null
      }]);
    vi.mocked(api.createFrontDeskVisitor).mockResolvedValue({
      id: 'visitor-1', visitorName: 'Visitor One', purpose: 'Meeting', hostStaffId: null,
      status: 'checked_in', checkedInAt: '2026-11-05T10:00:00', checkedOutAt: null
    });
    vi.mocked(api.frontDeskDashboard).mockResolvedValue({
      visitorsToday: 0, appointmentsToday: 0, pendingMessages: 0
    });

    render(<MemoryRouter><FrontDeskPage t={(key) => key} permissions={[
      'frontdesk.dashboard.view', 'frontdesk.visitors.view', 'frontdesk.visitors.manage'
    ]} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('frontDeskVisitorName'), {
      target: { value: 'Visitor One' }
    });
    fireEvent.change(screen.getByLabelText('frontDeskPurpose'), { target: { value: 'Meeting' } });
    fireEvent.click(screen.getByRole('button', { name: 'frontDeskCheckIn' }));

    await waitFor(() => expect(api.createFrontDeskVisitor).toHaveBeenCalledWith({
      visitorName: 'Visitor One', purpose: 'Meeting', hostStaffId: null
    }));
    expect(await screen.findByRole('button', { name: 'frontDeskCheckOut' })).toBeTruthy();
  });

  it('lets receptionists look up student-specific authorized guardians without managing authorizations', async () => {
    vi.mocked(api.frontDeskAuthorizations).mockResolvedValue([{
      id: 'authorization-1', studentId: 'student-1', guardianName: 'Guardian One',
      relationship: 'Parent', phone: '', authorizationType: 'regular', oneTime: false,
      expiresAt: null, usedAt: null, status: 'active'
    }]);

    render(<MemoryRouter><FrontDeskPage t={(key) => key} permissions={[
      'frontdesk.pickup.release', 'frontdesk.pickup.authorizations.view'
    ]} /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText('frontDeskStudentId'), {
      target: { value: 'student-1' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'frontDeskFindGuardians' }));

    expect(await screen.findByRole('option', { name: /student-1 — Guardian One/ })).toBeTruthy();
    expect(api.frontDeskAuthorizations).toHaveBeenCalledWith({
      page: 1, pageSize: 50, studentId: 'student-1'
    });
    expect(screen.queryByText('frontDeskAddAuthorization')).toBeNull();
  });

  it('offers return, claim, and disposal actions for active front-desk records', async () => {
    vi.mocked(api.frontDeskDeliveries).mockResolvedValue([{
      id: 'delivery-1', recipientName: 'Staff Member', description: 'Package',
      status: 'received', receivedAt: '2026-11-05T10:00:00', collectedAt: null
    }]);
    vi.mocked(api.frontDeskLostFound).mockResolvedValue([{
      id: 'lost-1', description: 'Umbrella', locationFound: 'Lobby',
      foundAt: '2026-11-05T10:00:00', status: 'unclaimed', claimedBy: null, claimedAt: null
    }]);
    vi.mocked(api.updateFrontDeskLostFoundStatus).mockResolvedValue({
      id: 'lost-1', description: 'Umbrella', locationFound: 'Lobby',
      foundAt: '2026-11-05T10:00:00', status: 'claimed', claimedBy: 'Owner',
      claimedAt: '2026-11-05T11:00:00'
    });

    render(<MemoryRouter><FrontDeskPage t={(key) => key} permissions={[
      'frontdesk.deliveries.view', 'frontdesk.deliveries.manage',
      'frontdesk.lost-found.view', 'frontdesk.lost-found.manage'
    ]} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('tab', { name: 'frontDeskDeliveries' }));
    expect(await screen.findByRole('button', { name: 'frontDeskMarkReturned' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'frontDeskMarkReturned' }));
    await waitFor(() => expect(api.updateFrontDeskDeliveryStatus).toHaveBeenCalledWith(
      'delivery-1', 'returned'
    ));

    fireEvent.click(screen.getByRole('tab', { name: 'frontDeskLostFound' }));
    expect(await screen.findByLabelText('frontDeskClaimant')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'frontDeskMarkDisposed' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('frontDeskClaimant'), { target: { value: 'Owner' } });
    fireEvent.click(screen.getByRole('button', { name: 'frontDeskMarkClaimed' }));
    await waitFor(() => expect(api.updateFrontDeskLostFoundStatus).toHaveBeenCalledWith(
      'lost-1', { status: 'claimed', claimedBy: 'Owner' }
    ));
  });
});
