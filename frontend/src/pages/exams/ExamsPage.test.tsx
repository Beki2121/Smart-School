import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExamsPage from './ExamsPage';
import { api } from '../../api';

beforeEach(() => {
  vi.spyOn(api, 'examTypes').mockResolvedValue([]);
  vi.spyOn(api, 'exams').mockResolvedValue([{
    id: 'exam-1', title: 'Term quiz', status: 'schedule_published',
    organizationId: 'org-1', campusId: 'campus-1', academicYearId: 'year-1',
    termId: 'term-1', gradeLevelId: 'grade-1', subjectId: 'subject-1',
    examTypeId: 'type-1', weightBasisPoints: 10000, maxValue: 100, isLegacy: false,
    schedulePublishedAt: '2026-03-01T10:00:00.000Z', marksOpenedAt: null,
    examType: 'Quiz', scheduleEntries: [{
      id: 'entry-1', examId: 'exam-1', examTitle: 'Term quiz',
      status: 'schedule_published', sectionId: 'section-1', sectionName: 'Grade 7A',
      examDate: '2026-03-02', startsAt: '09:00:00', endsAt: '10:00:00',
      roomId: null, roomName: null, invigilators: []
    }]
  }]);
  vi.spyOn(api, 'examMonitoring').mockResolvedValue([{
    id: 'exam-1', title: 'Term quiz', status: 'schedule_published',
    expectedMarks: 20, recordedMarks: 18, missingMarks: 2
  }]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('exams page', () => {
  it('shows the published schedule and missing-mark counts to a read-only monitor', async () => {
    render(<ExamsPage t={(key) => key} locale="en" canManage={false} canMonitor />);

    expect(await screen.findByRole('heading', { name: 'examsTitle' })).toBeTruthy();
    expect(screen.getAllByText('Term quiz')).toHaveLength(2);
    expect(screen.getByText('Grade 7A')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'publishSchedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'openMarks' })).toBeNull();
  });

  it('lets an administrator schedule an unscheduled exam draft', async () => {
    vi.mocked(api.exams).mockResolvedValue([{
      id: 'draft-1', title: 'Unscheduled exam', status: 'draft',
      organizationId: 'org-1', campusId: 'campus-1', academicYearId: 'year-1',
      termId: 'term-1', gradeLevelId: 'grade-1', subjectId: 'subject-1',
      examTypeId: 'type-1', weightBasisPoints: 10000, maxValue: 100, isLegacy: false,
      schedulePublishedAt: null, marksOpenedAt: null, scheduleEntries: []
    }]);
    vi.spyOn(api, 'terms').mockResolvedValue([{
      id: 'term-1', academicYearId: 'year-1', name: 'Term 1', periodType: 'term',
      startDate: '2026-01-01', endDate: '2026-12-31', isCurrent: true
    }]);
    vi.spyOn(api, 'grades').mockResolvedValue([{
      id: 'grade-1', campusId: 'campus-1', code: 'G1',
      nameEn: 'Grade 1', nameAm: '1', band: 'primary', sortOrder: 1
    }]);
    vi.spyOn(api, 'subjects').mockResolvedValue([{
      id: 'subject-1', campusId: 'campus-1', code: 'EN',
      nameEn: 'English', nameAm: 'English', category: 'core'
    }]);
    vi.spyOn(api, 'sections').mockResolvedValue([{
      id: 'section-1', campusId: 'campus-1', name: 'Grade 1A', gradeLevelId: 'grade-1'
    }]);
    vi.spyOn(api, 'rooms').mockResolvedValue([]);
    vi.spyOn(api, 'staff').mockResolvedValue([]);
    vi.spyOn(api, 'gradeSubjects').mockResolvedValue([]);

    render(<ExamsPage t={(key) => key} locale="en" canManage canMonitor={false} />);

    expect(await screen.findByText('unscheduled')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'addScheduleEntry' }));
    expect(await screen.findByRole('heading', {
      name: 'addScheduleEntry: Unscheduled exam'
    })).toBeTruthy();
    expect(screen.getAllByRole('combobox', { name: 'section' })).toHaveLength(2);
  });
});
