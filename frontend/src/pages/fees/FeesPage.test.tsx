import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeesPage from './FeesPage';

vi.mock('../../api', () => ({
  api: {
    feeItems: () => Promise.resolve([]),
    feeInvoices: () => Promise.resolve([])
  }
}));

afterEach(() => cleanup());

describe('fees page', () => {
  it('renders finance data without management controls for a read-only role', async () => {
    render(
      <FeesPage
        t={(key) => key}
        locale="en"
        canManage={false}
        canCollect={false}
        canReverse={false}
      />
    );

    expect(await screen.findByRole('heading', { name: 'fees' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'feeItems' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'issueInvoice' })).toBeNull();
  });
});
