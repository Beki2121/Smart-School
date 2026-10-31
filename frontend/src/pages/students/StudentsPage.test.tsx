import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import StudentsPage from './StudentsPage';

afterEach(() => cleanup());

describe('students page', () => {
  it('loads student records and hides management actions from read-only users', async () => {
    render(
      <StudentsPage
        t={(key) => key}
        locale="en"
        canManage={false}
        canViewAlumni={false}
        canManageAdmissions={false}
        canOverrideProgression={false}
        canViewSensitiveData={false}
        canManageSensitiveData={false}
        canViewEmergencyContacts={false}
        canManageEmergencyContacts={false}
        canViewGuardians={false}
        canViewCommendations={false}
        canManageCommendations={false}
        canViewDiscipline={false}
        canManageDiscipline={false}
        canApproveTransfers={false}
      />
    );

    expect(await screen.findByRole('heading', { name: 'studentRecords' })).toBeTruthy();
    expect(screen.getByText('emptyStudents')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'addStudent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'importStudents' })).toBeNull();
  });
});
