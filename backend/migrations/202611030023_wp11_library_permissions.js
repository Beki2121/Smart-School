import { createHash } from 'node:crypto';

export const libraryPermissionRoles = {
  'library.catalog.view': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.catalog.manage': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.circulation.manage': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.members.manage': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.fines.view': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.fines.manage': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.fines.waive': ['owner_director', 'principal', 'system_admin'],
  'library.reports.view': ['library_librarian', 'owner_director', 'principal', 'system_admin'],
  'library.portal.view': ['student', 'parent_guardian', 'homeroom_teacher', 'subject_teacher']
};

function systemRoleId(roleKey) {
  const bytes = createHash('sha256').update(`sims-system-role:${roleKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(libraryPermissionRoles).flat())];
    const roleRows = await trx('roles').whereNull('organization_id')
      .whereIn('key', roleKeys).select('id', 'key');
    const ids = new Map(roleRows.map((row) => [row.key, row.id]));
    const missing = roleKeys.filter((key) => !ids.has(key)).map((key) => ({
      id: systemRoleId(key), organization_id: null, key,
      name: key.split('_').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' '),
      is_system: true
    }));
    if (missing.length) {
      await trx('roles').insert(missing);
      for (const role of missing) ids.set(role.key, role.id);
    }
    const keys = Object.keys(libraryPermissionRoles);
    const currentPermissions = new Set((await trx('permissions')
      .whereIn('key', keys).select('key')).map((row) => row.key));
    const newPermissions = keys.filter((key) => !currentPermissions.has(key))
      .map((key) => ({ key, description: key }));
    if (newPermissions.length) await trx('permissions').insert(newPermissions);
    const assigned = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id').whereNull('r.organization_id')
      .whereIn('r.key', roleKeys).whereIn('rp.permission_key', keys)
      .select('r.key as role_key', 'rp.permission_key'))
      .map((row) => `${row.role_key}\u0000${row.permission_key}`));
    const additions = [];
    for (const [permissionKey, assignedRoles] of Object.entries(libraryPermissionRoles)) {
      for (const roleKey of assignedRoles) {
        if (!assigned.has(`${roleKey}\u0000${permissionKey}`)) {
          additions.push({ role_id: ids.get(roleKey), permission_key: permissionKey });
        }
      }
    }
    if (additions.length) await trx('role_permissions').insert(additions);
  });
}

export async function down() {
  throw new Error('WP11 library permission migration is forward-only.');
}
