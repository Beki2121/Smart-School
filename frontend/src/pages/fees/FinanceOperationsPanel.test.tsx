import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import FinanceOperationsPanel from './FinanceOperationsPanel';

vi.mock('../../api', () => ({
  api: {
    financeDashboard: vi.fn().mockResolvedValue({
      overdueInvoices: 1, collections: [], outstandingByCurrency: []
    }),
    feeArrears: vi.fn().mockResolvedValue([{
      invoiceId: 'invoice-1', invoiceNumber: 'INV-1', studentId: 'student-1',
      studentNo: 'S-1', studentName: 'Student One', sectionName: 'Grade 1 A',
      dueDate: '2026-10-01', daysOverdue: 30, bucket: '1_30',
      balanceDue: 10, currencyCode: 'ETB', followups: []
    }]),
    feeInvoices: vi.fn().mockResolvedValue([]),
    cashbookAccounts: vi.fn().mockResolvedValue([]),
    feeStructures: vi.fn().mockResolvedValue([]),
    feeDiscountRequests: vi.fn().mockResolvedValue([{
      id: 'discount-1', studentId: 'student-1', discountTypeId: 'type-1',
      periodKey: '2026-10', reason: 'Scholarship', status: 'pending', requestedBy: 'cashier'
    }]),
    feeDiscountTypes: vi.fn().mockResolvedValue([]),
    feeRefundRequests: vi.fn().mockResolvedValue([]),
    feeAdjustmentRequests: vi.fn().mockResolvedValue([]),
    academicYears: vi.fn().mockResolvedValue([]),
    grades: vi.fn().mockResolvedValue([]),
    createFeeArrearsFollowup: vi.fn().mockResolvedValue({ id: 'followup-1' })
  }
}));

afterEach(() => cleanup());

describe('finance operations panel', () => {
  beforeEach(() => {
    vi.mocked(api.financeDashboard).mockResolvedValue({
      overdueInvoices: 1, collections: [], outstandingByCurrency: []
    });
    vi.mocked(api.feeArrears).mockResolvedValue([{
      invoiceId: 'invoice-1', invoiceNumber: 'INV-1', studentId: 'student-1',
      studentNo: 'S-1', studentName: 'Student One', sectionName: 'Grade 1 A',
      dueDate: '2026-10-01', daysOverdue: 30, bucket: '1_30',
      balanceDue: 10, currencyCode: 'ETB', followups: []
    }]);
    vi.mocked(api.feeInvoices).mockResolvedValue([]);
    vi.mocked(api.cashbookAccounts).mockResolvedValue([]);
    vi.mocked(api.feeStructures).mockResolvedValue([]);
    vi.mocked(api.feeDiscountRequests).mockResolvedValue([{
      id: 'discount-1', studentId: 'student-1', discountTypeId: 'type-1',
      periodKey: '2026-10', reason: 'Scholarship', status: 'pending', requestedBy: 'cashier'
    }]);
    vi.mocked(api.feeDiscountTypes).mockResolvedValue([]);
    vi.mocked(api.feeRefundRequests).mockResolvedValue([]);
    vi.mocked(api.feeAdjustmentRequests).mockResolvedValue([]);
    vi.mocked(api.academicYears).mockResolvedValue([]);
    vi.mocked(api.grades).mockResolvedValue([]);
  });

  it('only shows principal approval controls and lets finance staff record follow-ups', async () => {
    render(<FinanceOperationsPanel t={(key) => key} locale="en"
      canManage canCollect={false} canApprove={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'showFinanceOperations' }));

    expect(await screen.findByText('Scholarship')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'approve' })).toBeNull();

    fireEvent.change(screen.getByLabelText('followupNote'), {
      target: { value: 'Called the guardian.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'addFollowup' }));

    await waitFor(() => expect(api.createFeeArrearsFollowup).toHaveBeenCalledWith(
      'invoice-1', { note: 'Called the guardian.' }
    ));
  });

  it('shows approval controls to a principal', async () => {
    render(<FinanceOperationsPanel t={(key) => key} locale="en"
      canManage canCollect={false} canApprove />);
    fireEvent.click(screen.getByRole('button', { name: 'showFinanceOperations' }));

    expect(await screen.findByRole('button', { name: 'approve' })).toBeTruthy();
  });
});
