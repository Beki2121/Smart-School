import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import RolesPermissionsPage from './RolesPermissionsPage';

vi.mock('../../api', () => ({
  api: {
    roles: vi.fn(),
    createRole: vi.fn(),
    updateRolePermissions: vi.fn()
  }
}));

afterEach(() => cleanup());

describe('roles and permissions page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.roles).mockResolvedValue({
      roles: [
        { id: 'system-owner', organizationId: null, key: 'owner_director',
          name: 'School Administrator', isSystem: true, permissions: [
            'account.view', 'accounts.manage', 'school.branches.manage',
            'school.export', 'school.close'
          ] },
        { id: 'custom-role', organizationId: 'school-1', key: 'custom_staff_view',
          name: 'Staff Viewer', isSystem: false, permissions: ['account.view'] }
      ],
      permissions: [
        { key: 'account.view', description: 'View accounts' },
        { key: 'accounts.manage', description: 'Manage accounts' },
        { key: 'school.branches.manage', description: 'Manage branches' },
        { key: 'school.export', description: 'Export school data' },
        { key: 'school.close', description: 'Close school' },
        { key: 'staff.view', description: 'View staff' }
      ]
    });
    vi.mocked(api.updateRolePermissions).mockImplementation(async (key, permissions) => ({
      id: 'custom-role', organizationId: 'school-1', key, name: 'Staff Viewer',
      isSystem: false, permissions
    }));
    vi.mocked(api.createRole).mockImplementation(async (name, permissions) => ({
      id: 'new-role', organizationId: 'school-1', key: 'custom_new', name,
      isSystem: false, permissions
    }));
  });

  it('groups the matrix by module and saves custom-role permission changes', async () => {
    render(<RolesPermissionsPage t={(key) => key} />);
    expect(await screen.findByRole('heading', { name: 'rolesPermissions' })).toBeTruthy();
    expect(screen.getByText('account')).toBeTruthy();
    expect(screen.getByText('staff')).toBeTruthy();

    const staffPermission = screen.getByRole('checkbox', { name: 'staff.view allowed' });
    await waitFor(() => expect((staffPermission as HTMLInputElement).checked).toBe(false));
    fireEvent.click(staffPermission);
    fireEvent.click(screen.getByRole('button', { name: 'savePermissions' }));
    await waitFor(() => expect(api.updateRolePermissions).toHaveBeenCalledWith(
      'custom_staff_view', ['account.view', 'staff.view']
    ));
  });

  it('keeps critical system-role permissions read-only and exposes no delete action', async () => {
    render(<RolesPermissionsPage t={(key) => key} />);
    await screen.findByRole('heading', { name: 'rolesPermissions' });
    fireEvent.change(screen.getByLabelText('selectRole'), {
      target: { value: 'owner_director' }
    });

    for (const permission of [
      'accounts.manage', 'school.branches.manage', 'school.export', 'school.close'
    ]) {
      const checkbox = screen.getByRole('checkbox', { name: `${permission} allowed` });
      expect((checkbox as HTMLInputElement).checked).toBe(true);
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.queryByRole('button', { name: 'deleteRole' })).toBeNull();
    expect(api.updateRolePermissions).not.toHaveBeenCalled();
  });
});
