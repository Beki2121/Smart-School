import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api, Dashboard, User } from '../../api';
import DashboardPage from './DashboardPage';

vi.mock('../../api', () => ({
  api: {
    dashboard: vi.fn(),
    admissionDashboard: vi.fn(),
    auditLog: vi.fn()
  }
}));

const dashboard: Dashboard = {
  studentCount: 2, attendanceSessions: 1, marksRecorded: 3, attendanceToday: 1,
  recentStudents: [], sectionDistribution: [], genderTotals: { female: 1, male: 1, other: 0 },
  mode: 'mysql'
};

function user(role: string): User {
  return { id: 'user-id', name: 'Test User', role, campusIds: ['campus-id'], activeCampusId: 'campus-id' };
}

afterEach(() => vi.restoreAllMocks());

describe('role dashboards', () => {
  it('shows teacher-specific class and lesson planning shortcuts', async () => {
    vi.mocked(api.dashboard).mockResolvedValue(dashboard);

    render(<MemoryRouter><DashboardPage
      t={(key) => key} user={user('subject_teacher')} locale="en"
    /></MemoryRouter>);

    expect(await screen.findByText('teacherDashboard')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /myClasses/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /lessonPlanning/ }).length).toBeGreaterThan(0);
    expect(api.admissionDashboard).not.toHaveBeenCalled();
  });

  it('shows WP1 failed-login alerts on the school IT dashboard', async () => {
    vi.mocked(api.dashboard).mockResolvedValue(dashboard);
    vi.mocked(api.auditLog).mockResolvedValue({
      events: [{
        id: 'event-1', organizationId: 'org-id', organizationName: 'School',
        campusId: 'campus-id', campusName: 'Campus', actorId: null, actorName: '',
        actorEmail: '', actorRole: '', action: 'auth.login_failed', entityType: 'user',
        entityId: null, before: null, after: null, ipAddress: '192.0.2.1',
        userAgent: '', createdAt: '2026-11-03T10:00:00.000Z'
      }],
      total: 1, page: 1, pageSize: 5
    });

    render(<MemoryRouter><DashboardPage
      t={(key) => key} user={user('system_admin')} locale="en"
    /></MemoryRouter>);

    expect(await screen.findByText('schoolItDashboard')).toBeTruthy();
    expect(await screen.findByText('failedLoginAlert')).toBeTruthy();
    expect(screen.getByText(/192\.0\.2\.1/)).toBeTruthy();
    expect(api.auditLog).toHaveBeenCalledWith({
      page: 1, pageSize: 5, action: 'auth.login_failed'
    });
  });
});
