import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import PayrollPage from './PayrollPage';

vi.mock('../../api', () => ({
  api: {
    payrollDashboard: vi.fn(),
    payrollRules: vi.fn(),
    payrollSalaryStructures: vi.fn(),
    payrollPeriods: vi.fn(),
    payrollPayslips: vi.fn()
  }
}));

afterEach(() => vi.restoreAllMocks());

describe('PayrollPage', () => {
  it('loads the payroll dashboard and hides payslips from a non-payroll reviewer', async () => {
    vi.mocked(api.payrollDashboard).mockResolvedValue({
      currentPeriods: 1, periods: [],
      currencies: [{ currencyCode: 'USD', grossMinor: 120000, netMinor: 90000,
        pendingApprovals: 1, pendingPayments: 2 }]
    });
    vi.mocked(api.payrollRules).mockResolvedValue([]);
    vi.mocked(api.payrollSalaryStructures).mockResolvedValue([]);
    vi.mocked(api.payrollPeriods).mockResolvedValue([]);

    render(<PayrollPage t={(key) => key}
      permissions={['payroll.run.view', 'payroll.structures.view']} />);

    expect(await screen.findByText('payrollHint')).toBeTruthy();
    expect(screen.getByText('payrollCurrentPeriods')).toBeTruthy();
    expect(screen.getByText('payrollPendingApprovals')).toBeTruthy();
    expect(screen.queryByText('payrollPayslips')).toBeNull();
    await waitFor(() => expect(api.payrollPayslips).not.toHaveBeenCalled());
  });

  it('loads salary structures and payslips for authorized payroll staff', async () => {
    vi.mocked(api.payrollDashboard).mockResolvedValue({
      currentPeriods: 0, periods: [], currencies: []
    });
    vi.mocked(api.payrollRules).mockResolvedValue([]);
    vi.mocked(api.payrollSalaryStructures).mockResolvedValue([]);
    vi.mocked(api.payrollPeriods).mockResolvedValue([]);
    vi.mocked(api.payrollPayslips).mockResolvedValue([]);

    render(<PayrollPage t={(key) => key} permissions={[
      'payroll.run.view', 'payroll.structures.view', 'payroll.structures.manage',
      'payroll.payslips.view'
    ]} />);

    expect(await screen.findByText('payrollSalaryStructures')).toBeTruthy();
    expect(screen.getByText('payrollPayslips')).toBeTruthy();
    await waitFor(() => expect(api.payrollPayslips).toHaveBeenCalledOnce());
  });
});
