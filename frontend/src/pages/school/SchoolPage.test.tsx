import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SchoolPage from './SchoolPage';

vi.mock('../../api', () => ({
  api: {
    school: () => Promise.resolve({
      id: 'campus-1', name: 'Sample School', address: '', phone: '',
      timezone: 'Africa/Addis_Ababa'
    }),
    academicYear: () => Promise.resolve(null),
    academicYears: () => Promise.resolve([]),
    terms: () => Promise.resolve([]),
    grades: () => Promise.resolve([]),
    curriculumGrades: () => Promise.resolve([]),
    sections: () => Promise.resolve([]),
    subjects: () => Promise.resolve([]),
    schoolCalendar: () => Promise.resolve([]),
    curriculumUnits: () => Promise.resolve([]),
    promotionRules: () => Promise.resolve([])
  }
}));

afterEach(() => cleanup());

describe('school setup page', () => {
  it('renders school profile and academic setup sections', async () => {
    render(<SchoolPage t={(key) => key} locale="en" />);

    expect(await screen.findByRole('heading', { name: 'schoolSetup' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sample School' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'setupAcademic' })).toBeTruthy();
  });
});
