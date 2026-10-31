import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SchoolSubscriptionPage from './SchoolSubscriptionPage';

vi.mock('../../api', () => ({
  api: {
    schoolSettings: () => Promise.resolve({
      name: 'Sample School',
      preferredLocale: 'en',
      currencyCode: 'ETB',
      branding: { logoUrl: '', primaryColor: '#0f766e' }
    }),
    schoolSubscription: () => Promise.resolve(null)
  }
}));

afterEach(() => cleanup());

describe('school subscription page', () => {
  it('renders school settings and subscription information', async () => {
    render(<SchoolSubscriptionPage t={(key) => key} />);

    expect(await screen.findByRole('heading', { name: 'Sample School' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'schoolSettings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'schoolClosure' })).toBeTruthy();
  });
});
