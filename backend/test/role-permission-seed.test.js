import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { examPermissionRoles } from '../migrations/202611030005_exams_permissions.js';
import { financePermissionRoles } from '../migrations/202611030006_wp5_finance_permissions.js';
import { assignmentPermissionRoles } from '../migrations/202611030009_wp6_assignments_permissions.js';
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
  it('combines the immutable baseline and feature permission migrations to match authorization defaults', () => {
    assert.deepEqual(
      toRolePermissions({
        ...seededPermissionRoles, ...examPermissionRoles, ...financePermissionRoles,
        ...assignmentPermissionRoles
      }),
      toRolePermissions(permissionRoles)
    );
  });

  it('seeds the memory authorization adapter with the current permission set', async () => {
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
