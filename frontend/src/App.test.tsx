import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import DashboardPage from './pages/dashboard/DashboardPage';
import PortalPage from './pages/portal/PortalPage';

vi.mock('./api', () => ({
  api: {
    me: () => Promise.reject(new Error('No active session')),
    invitationDetails: () => Promise.resolve({
      email: 'invited@example.test', role: 'teacher', name: 'Invited User', expiresAt: ''
    }),
    publicAdmissionInfo: () => Promise.resolve({
      schoolName: 'Sample School', campusName: 'Main Campus', address: 'Addis Ababa',
      phone: '', grades: [{ id: 'grade-1', nameEn: 'Grade 1', nameAm: '1ኛ ክፍል' }]
    }),
    portalHome: () => Promise.resolve({
      role: 'parent_guardian',
      students: [{
        student: {
          id: 'student-1', campusId: 'campus-1', studentNo: 'SIMS-001',
          name: 'Abebe Alem', nameAm: 'አበበ አለም', sectionName: 'Grade 1A', status: 'active'
        },
        canViewResults: false, canViewFees: false, results: [], reports: [],
        attendance: [{ date: '2026-10-30', status: 'present' }], fees: []
      }]
    }),
    dashboard: () => Promise.resolve({
      studentCount: 18, attendanceSessions: 2, marksRecorded: 42, attendanceToday: 16,
      recentStudents: [], sectionDistribution: [{ sectionName: 'Grade 1A', count: 18 }],
      genderTotals: { female: 9, male: 8, other: 1 }, mode: 'mysql'
    })
  },
  pendingOfflineCount: () => Promise.resolve(0),
  setAccessToken: () => {},
  syncOfflineOperations: () => Promise.resolve(0)
}));

const renderApp = (path = '/') => render(
  <MemoryRouter initialEntries={[path]}>
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

  it('loads the invitation setup page from its token route', async () => {
    renderApp('/invite/example-token');

    expect(await screen.findByRole('heading', { name: 'Set up your account' })).toBeTruthy();
    expect(screen.getByText('Invited User · invited@example.test')).toBeTruthy();
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
  });

  it('loads the public admission form from its token route', async () => {
    renderApp(`/apply/${'a'.repeat(64)}`);

    expect(await screen.findByRole('heading', { name: 'Sample School · Main Campus' })).toBeTruthy();
    expect(screen.getByLabelText('Given name (Latin)')).toBeTruthy();
    expect(screen.getByLabelText('Applying grade')).toBeTruthy();
  });

  it('shows linked students and only permitted family portal sections', async () => {
    const { container } = render(
      <MemoryRouter>
        <PortalPage
          user={{
            id: 'guardian-1', name: 'Parent User', role: 'parent_guardian',
            campusIds: ['campus-1'], activeCampusId: 'campus-1'
          }}
          locale="en" t={(key) => key} onLogout={async () => {}}
        />
      </MemoryRouter>
    );

    expect(await screen.findByText('Abebe Alem')).toBeTruthy();
    expect(screen.getByText('2026-10-30: present')).toBeTruthy();
    expect(container.querySelector('a[href="#portal-children"]')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'results' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'fees' })).toBeNull();
  });

  it('renders dashboard totals and grade distribution', async () => {
    render(
      <MemoryRouter>
        <DashboardPage
          user={{
            id: 'owner-1', name: 'School Owner', role: 'owner_director',
            campusIds: ['campus-1'], activeCampusId: 'campus-1'
          }}
          locale="en" t={(key) => key}
        />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'welcome, School Owner' })).toBeTruthy();
    expect(screen.getByText('Grade 1A')).toBeTruthy();
    expect(screen.getAllByText('18')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /addLearner/ }).getAttribute('href')).toBe('/students');
  });
});
