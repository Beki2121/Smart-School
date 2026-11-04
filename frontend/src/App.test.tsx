import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { api } from './api';
import AdmissionsPage from './pages/admissions/AdmissionsPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import PortalPage from './pages/portal/PortalPage';
import LandingPage from './pages/public/LandingPage';

vi.mock('./api', () => ({
  api: {
    me: vi.fn(() => Promise.reject(new Error('No active session'))),
    schoolBranches: vi.fn(() => Promise.resolve([])),
    switchBranch: vi.fn(),
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
    exams: () => Promise.resolve([]),
    portalAssignments: () => Promise.resolve([]),
    portalCalendar: () => Promise.resolve({
      students: [{ id: 'student-1', name: 'Abebe Alem', sectionId: 'section-1', sectionName: 'Grade 1A' }],
      announcements: [], events: [], timetable: []
    }),
    portalLibrary: () => Promise.resolve({ loans: [], reservations: [], fines: [] }),
    portalRequests: () => Promise.resolve([]),
    portalSupportRequests: () => Promise.resolve([]),
    portalMessageThreads: () => Promise.resolve([]),
    notifications: () => Promise.resolve({ items: [], unreadCount: 0 }),
    markPortalThreadRead: () => Promise.resolve({ threadId: 'thread-1', readAt: '' }),
    markNotificationRead: () => Promise.resolve({}),
    dashboard: () => Promise.resolve({
      studentCount: 18, attendanceSessions: 2, marksRecorded: 42, attendanceToday: 16,
      recentStudents: [], sectionDistribution: [{ sectionName: 'Grade 1A', count: 18 }],
      genderTotals: { female: 9, male: 8, other: 1 }, mode: 'mysql'
    }),
    admissions: () => Promise.resolve([{
      id: 'admission-1', campusId: 'campus-1', academicYearId: 'year-1',
      givenNameAm: 'አበበ', fatherNameAm: 'አለም', grandfatherNameAm: 'ተስፋዬ',
      givenNameEn: 'Abebe', fatherNameEn: 'Alem', grandfatherNameEn: 'Tesfaye',
      gender: 'male', dateOfBirth: null, guardianName: 'Parent One',
      guardianPhone: '0911000000', guardianEmail: null, gradeLevelId: 'grade-1',
      gradeName: 'Grade 1', previousSchool: null, status: 'enquiry',
      requiredDocuments: [], documentChecklist: [], documents: [], interviewAt: null,
      interviewResult: null, decisionNote: '', sectionId: null, studentId: null,
      siblingStudentId: null, studentNo: null
    }]),
    admissionDashboard: () => Promise.resolve({
      total: 1, byStatus: { enquiry: 1 }, byGrade: []
    }),
    grades: () => Promise.resolve([]),
    sections: () => Promise.resolve([]),
    students: () => Promise.resolve([])
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
  vi.mocked(api.me).mockImplementation(() => Promise.reject(new Error('No active session')));
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
  it('shows a public landing page with a sign-in route', async () => {
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Bring your school community into focus.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('button', { name: 'Register a school' })).toBeNull();
  });

  it('shows the sign-in form at /login and supports password visibility', async () => {
    renderApp('/login');

    expect(await screen.findByRole('heading', { name: 'Sign in to SIMS' })).toBeTruthy();
    expect(screen.getByLabelText('Email, phone, or username')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Register a school' })).toBeNull();

    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
  });

  it('omits the contact section when no contact details are configured', () => {
    render(<MemoryRouter><LandingPage t={(key) => key} locale="en" onLocaleChange={() => {}}
      contact={{ email: '', phone: '', address: '' }} /></MemoryRouter>);

    expect(screen.queryByRole('region', { name: 'landingContactTitle' })).toBeNull();
  });

  it('shows only configured contact details', () => {
    render(<MemoryRouter><LandingPage t={(key) => key} locale="en" onLocaleChange={() => {}}
      contact={{ email: 'hello@example.test', phone: '0911222333', address: 'Addis Ababa' }} /></MemoryRouter>);

    expect(screen.getByRole('region', { name: 'landingContactTitle' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'hello@example.test' }).getAttribute('href')).toBe('mailto:hello@example.test');
    expect(screen.getByRole('link', { name: '0911222333' }).getAttribute('href')).toBe('tel:0911222333');
    expect(screen.getByText('Addis Ababa')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'contactPhone' })).toBeNull();
  });

  it('switches to an active branch using the branch session endpoint', async () => {
    const owner = {
      id: 'owner-1', name: 'Owner', role: 'owner_director',
      campusIds: ['branch-1', 'branch-2'], activeCampusId: 'branch-1'
    };
    vi.mocked(api.me).mockResolvedValue(owner);
    vi.mocked(api.schoolBranches).mockResolvedValue([
      { id: 'branch-1', organizationId: 'school-1', name: 'Main Branch', address: '', phone: '', timezone: 'UTC', isActive: true },
      { id: 'branch-2', organizationId: 'school-1', name: 'East Branch', address: '', phone: '', timezone: 'UTC', isActive: true }
    ]);
    vi.mocked(api.switchBranch).mockResolvedValue({ ...owner, activeCampusId: 'branch-2' });
    renderApp();

    const branchSelector = await screen.findByRole('combobox', { name: 'Switch branch' });
    fireEvent.change(branchSelector, { target: { value: 'branch-2' } });
    await waitFor(() => expect(api.switchBranch).toHaveBeenCalledWith('branch-2'));
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

    expect((await screen.findAllByText('Abebe Alem')).length).toBeGreaterThan(0);
    expect(screen.getByText('2026-10-30: present')).toBeTruthy();
    expect(container.querySelector('a[href="#portal-children"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /navSchoolServices/ }));
    expect(container.querySelector('a[href="#portal-announcements"]')).toBeTruthy();
    expect(container.querySelector('a[href="#portal-requests"]')).toBeTruthy();
    expect(container.querySelector('a[href="#portal-messages"]')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'results' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'fees' })).toBeNull();
  });

  it('shows student support and profile-request navigation without parent messaging', async () => {
    const { container } = render(
      <MemoryRouter>
        <PortalPage
          user={{
            id: 'student-user-1', name: 'Student User', role: 'student',
            campusIds: ['campus-1'], activeCampusId: 'campus-1'
          }}
          locale="en" t={(key) => key} onLogout={async () => {}}
        />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'studentSupport' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'profileUpdateRequest' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /navSchoolServices/ }));
    expect(container.querySelector('a[href="#portal-support"]')).toBeTruthy();
    expect(container.querySelector('a[href="#portal-messages"]')).toBeNull();
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

  it('renders admissions without exposing manager actions to read-only users', async () => {
    render(<AdmissionsPage t={(key) => key} canManage={false} />);

    expect(await screen.findByRole('heading', { name: 'admissions' })).toBeTruthy();
    expect(screen.getByText('Abebe Alem Tesfaye')).toBeTruthy();
    expect(screen.getAllByText('1 records')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /newEnquiry/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'moveToApplication' })).toBeNull();
  });
});
