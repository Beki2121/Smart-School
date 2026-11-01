import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, OrganizationBranch, User } from '../../api';
import BranchesPage from './BranchesPage';

vi.mock('../../api', () => ({
  api: {
    schoolBranches: vi.fn(),
    createSchoolBranch: vi.fn(),
    updateSchoolBranch: vi.fn(),
    me: vi.fn()
  }
}));

const user: User = {
  id: 'owner-1', name: 'Owner', role: 'owner_director',
  campusIds: ['branch-1'], activeCampusId: 'branch-1'
};
const branch: OrganizationBranch = {
  id: 'branch-1', organizationId: 'school-1', name: 'Main Branch',
  address: '', phone: '', timezone: 'Africa/Addis_Ababa', isActive: true
};
const t = (key: string) => key;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('branch management', () => {
  it('creates a branch and refreshes owner membership', async () => {
    const updatedUser = { ...user, campusIds: ['branch-1', 'branch-2'] };
    vi.mocked(api.schoolBranches).mockResolvedValueOnce([branch]).mockResolvedValueOnce([
      branch, { ...branch, id: 'branch-2', name: 'East Branch' }
    ]);
    vi.mocked(api.createSchoolBranch).mockResolvedValue({ ...branch, id: 'branch-2' });
    vi.mocked(api.me).mockResolvedValue(updatedUser);
    const onUserUpdate = vi.fn();

    render(<BranchesPage t={t} user={user} onUserUpdate={onUserUpdate} />);
    expect(await screen.findByText('Main Branch')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'deactivateBranch' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('branchName'), { target: { value: 'East Branch' } });
    fireEvent.click(screen.getByRole('button', { name: 'createBranch' }));

    await screen.findByText('branchCreated');
    expect(api.createSchoolBranch).toHaveBeenCalledWith({
      name: 'East Branch', address: '', phone: ''
    });
    expect(onUserUpdate).toHaveBeenCalledWith(updatedUser);
    await waitFor(() => expect(screen.getByText('East Branch')).toBeTruthy());
  });
});
