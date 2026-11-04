import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import HrDashboardPage from './HrDashboardPage';

vi.mock('../../api', () => ({
  api: { hrDashboard: vi.fn() }
}));

afterEach(() => vi.restoreAllMocks());

describe('HrDashboardPage', () => {
  it('renders staff, leave, and contract-expiry metrics', async () => {
    vi.mocked(api.hrDashboard).mockResolvedValue({
      totalStaff: 24,
      activeStaff: 21,
      pendingLeaveRequests: 2,
      contractsExpiringWithin30Days: 3
    });

    render(<HrDashboardPage t={(key) => key} />);

    expect(await screen.findByText('hrTotalStaff')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('hrActiveStaff')).toBeTruthy();
    expect(screen.getByText('21')).toBeTruthy();
    expect(screen.getByText('hrPendingLeave')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('hrContractsExpiring')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });
});
