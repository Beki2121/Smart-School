import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seededPermissionRoles } from '../migrations/202611020002_seed_role_permissions.js';
import { permissionRoles } from '../src/middleware/permissions.js';
import { MemoryRepository } from '../src/repository.js';

function toRolePermissions(permissionRoleMap) {
  const result = {};
  for (const [permission, roles] of Object.entries(permissionRoleMap)) {
    for (const role of roles) (result[role] ??= []).push(permission);
  }
  for (const permissions of Object.values(result)) permissions.sort();
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) =>
    left.localeCompare(right)));
}

describe('role permission database seed', () => {
  it('preserves the exact role permissions from the legacy authorization map', () => {
    assert.deepEqual(
      toRolePermissions(seededPermissionRoles),
      toRolePermissions(permissionRoles)
    );
  });

  it('seeds the memory authorization adapter with the exact legacy permission set', async () => {
    const repo = new MemoryRepository({ users: [], campuses: [], sections: [], academicYears: [] });
    const expected = toRolePermissions(permissionRoles);
    const actual = Object.fromEntries(await Promise.all(
      Object.keys(expected).map(async (role) => [
        role, await repo.getRolePermissions('test-organization', role)
      ])
    ));
    assert.deepEqual(actual, expected);
  });
});
