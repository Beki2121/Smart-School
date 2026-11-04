import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, StaffMember } from '../../api';
import HrManagementPage from './HrManagementPage';

vi.mock('../../api', () => ({
  api: {
    staff: vi.fn(), departments: vi.fn(), hrContracts: vi.fn(), hrLeaveTypes: vi.fn(),
    hrLeaveBalances: vi.fn(), hrVacancies: vi.fn(), hrApplicants: vi.fn(),
    hrPerformanceCycles: vi.fn(), hrPerformanceGoals: vi.fn(),
    hrPerformanceEvaluations: vi.fn(), hrTrainingCourses: vi.fn(),
    hrStaffDocuments: vi.fn(), updateHrStaff: vi.fn(), archiveHrStaff: vi.fn(),
    createHrContract: vi.fn(), renewHrContract: vi.fn(), createHrLeaveType: vi.fn(),
    setHrLeaveBalance: vi.fn(), createHrVacancy: vi.fn(), createHrApplicant: vi.fn(),
    hrInterviews: vi.fn(), scheduleHrInterview: vi.fn(), decideHrApplicant: vi.fn(),
    hrApplicantDocuments: vi.fn(), uploadHrApplicantDocument: vi.fn(),
    downloadHrApplicantDocument: vi.fn(), createHrPerformanceCycle: vi.fn(),
    createHrPerformanceGoal: vi.fn(), createHrPerformanceEvaluation: vi.fn(),
    createHrTrainingCourse: vi.fn(), hrTrainingEnrollments: vi.fn(),
    enrollHrTraining: vi.fn(), updateHrTrainingAttendance: vi.fn(),
    uploadHrTrainingCertificate: vi.fn(), downloadHrTrainingCertificate: vi.fn(),
    uploadHrStaffDocument: vi.fn(), downloadHrStaffDocument: vi.fn(),
    previewHrStaffImport: vi.fn(), commitHrStaffImport: vi.fn()
  }
}));

const staffMember: StaffMember = {
  id: 'staff-1', campusId: 'campus-1', userId: null, departmentId: null,
  givenNameEn: 'Aster', fatherNameEn: 'Biruk', grandfatherNameEn: 'Desta',
  givenNameAm: 'አስቴር', fatherNameAm: 'ብሩክ', grandfatherNameAm: 'ደስታ',
  jobTitle: 'Teacher', qualification: 'BA', employmentStatus: 'active', hiredOn: '2024-01-01',
  name: 'Aster Biruk Desta', departmentName: 'Academic', teachingAssignmentCount: 0, homeroomCount: 0
};
const access = {
  staffView: true, staffEdit: true, staffArchive: true, staffImport: true,
  documentView: true, documentManage: true, contractView: true, contractManage: true,
  leaveView: true, leaveConfigure: true, balanceManage: true,
  recruitmentView: true, recruitmentManage: true,
  performanceView: true, performanceManage: true, trainingView: true, trainingManage: true
};
const empty = () => {
  vi.mocked(api.staff).mockResolvedValue([staffMember]);
  vi.mocked(api.departments).mockResolvedValue([]);
  vi.mocked(api.hrContracts).mockResolvedValue([]);
  vi.mocked(api.hrLeaveTypes).mockResolvedValue([]);
  vi.mocked(api.hrLeaveBalances).mockResolvedValue([]);
  vi.mocked(api.hrVacancies).mockResolvedValue([]);
  vi.mocked(api.hrApplicants).mockResolvedValue([]);
  vi.mocked(api.hrPerformanceCycles).mockResolvedValue([]);
  vi.mocked(api.hrPerformanceGoals).mockResolvedValue([]);
  vi.mocked(api.hrPerformanceEvaluations).mockResolvedValue([]);
  vi.mocked(api.hrTrainingCourses).mockResolvedValue([]);
  vi.mocked(api.hrStaffDocuments).mockResolvedValue([]);
};

beforeEach(() => { vi.clearAllMocks(); empty(); });
afterEach(() => cleanup());

describe('HrManagementPage', () => {
  it('lists staff, opens a profile editor, and saves profile changes', async () => {
    vi.mocked(api.updateHrStaff).mockResolvedValue(staffMember);
    render(<HrManagementPage t={(key) => key} access={access} />);

    expect(await screen.findByText('Aster Biruk Desta')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'edit' })[0]);
    fireEvent.change(screen.getByLabelText('jobTitle'), { target: { value: 'Senior Teacher' } });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(api.updateHrStaff).toHaveBeenCalledWith('staff-1',
      expect.objectContaining({ jobTitle: 'Senior Teacher' })));
  });

  it('shows each HR workflow section and creates a contract', async () => {
    vi.mocked(api.createHrContract).mockResolvedValue({
      id: 'contract-1', staffId: 'staff-1', contractType: 'permanent',
      startsOn: '2026-01-01', endsOn: null, renewalDueOn: null,
      status: 'active', notes: ''
    });
    render(<HrManagementPage t={(key) => key} access={access} />);
    expect(await screen.findByText('Aster Biruk Desta')).toBeTruthy();
    for (const section of ['hrContracts', 'hrLeave', 'hrRecruitment', 'hrPerformance', 'hrTraining']) {
      expect(screen.getByRole('button', { name: section })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'hrContracts' }));
    fireEvent.change(screen.getByLabelText('hrStartsOn'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(api.createHrContract).toHaveBeenCalledWith('staff-1',
      expect.objectContaining({ startsOn: '2026-01-01', contractType: 'permanent' })));
  });

  it('allows searching and opening the training enrollment list', async () => {
    vi.mocked(api.hrTrainingCourses).mockResolvedValue([{
      id: 'course-1', title: 'Safeguarding', description: 'Annual course',
      startsOn: '2026-01-01', endsOn: '2026-01-02', status: 'open'
    }]);
    vi.mocked(api.hrTrainingEnrollments).mockResolvedValue([]);
    render(<HrManagementPage t={(key) => key} access={access} />);
    expect(await screen.findByText('Aster Biruk Desta')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'hrTraining' }));
    fireEvent.click(await screen.findByRole('button', { name: 'view' }));
    await waitFor(() => expect(api.hrTrainingEnrollments).toHaveBeenCalledWith('course-1'));
    expect(screen.getByText('hrTrainingEnrollments')).toBeTruthy();
  });
});
