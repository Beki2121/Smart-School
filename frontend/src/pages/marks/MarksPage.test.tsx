import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarksPage from './MarksPage';

vi.mock('../../api', () => ({
  api: {
    students: () => Promise.resolve([]),
    marks: () => Promise.resolve([]),
    exams: () => Promise.resolve([]),
    marksContext: () => Promise.resolve({ terms: [], subjects: [] }),
    gradingBands: () => Promise.resolve([]),
    gradingPolicy: () => Promise.resolve({ scoringMethod: 'points_weighted' })
  },
  queueOfflineOperation: () => Promise.resolve()
}));

afterEach(() => cleanup());

describe('marks page', () => {
  it('renders the marks workflow without grading controls for a read-only role', async () => {
    render(
      <MarksPage
        t={(key) => key}
        onQueued={async () => {}}
        ownerId="owner-1"
        canManageGrading={false}
        canSubmitMarks={false}
        canApproveMarks={false}
        canPublishMarks={false}
        canAmendMarks={false}
        locale="en"
      />
    );

    expect(await screen.findByRole('heading', { name: 'marksTitle' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'termResultsSummary' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'gradingScale' })).toBeNull();
  });
});
