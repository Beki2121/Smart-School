import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

vi.mock('./api', () => ({
  api: {
    me: () => Promise.reject(new Error('No active session'))
  },
  pendingOfflineCount: () => Promise.resolve(0),
  setAccessToken: () => {},
  syncOfflineOperations: () => Promise.resolve(0)
}));

const renderApp = () => render(
  <MemoryRouter initialEntries={['/']}>
    <App />
  </MemoryRouter>
);

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
});
afterEach(() => cleanup());

describe('unauthenticated entry', () => {
  it('shows the sign-in form and supports password visibility', async () => {
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Sign in to SIMS' })).toBeTruthy();
    expect(screen.getByLabelText('Email, phone, or username')).toBeTruthy();

    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
  });

  it('opens school registration and returns to sign-in', async () => {
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Register a school' }));
    expect(screen.getByRole('heading', { name: 'Register a school' })).toBeTruthy();
    expect(screen.getByLabelText('School name')).toBeTruthy();
    expect(screen.getByLabelText('Owner / director')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('heading', { name: 'Sign in to SIMS' })).toBeTruthy();
  });
});
