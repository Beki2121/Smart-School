import { createHash } from 'node:crypto';

export const inventoryPermissionRoles = {
  'inventory.items.view': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.items.manage': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.purchases.manage': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.receiving.manage': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.adjustments.manage': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.assets.manage': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.allocations.manage': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.reports.view': ['store_keeper', 'owner_director', 'principal', 'system_admin'],
  'inventory.assets.self.view': ['homeroom_teacher', 'subject_teacher', 'hr_admin']
};

function systemRoleId(roleKey) {
  const bytes = createHash('sha256').update(`sims-system-role:${roleKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(inventoryPermissionRoles).flat())];
    const existing = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const ids = new Map(existing.map((role) => [role.key, role.id]));
    const missing = roleKeys.filter((key) => !ids.has(key)).map((key) => ({
      id: systemRoleId(key), organization_id: null, key,
      name: key.split('_').map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(' '),
      is_system: true
    }));
    if (missing.length) {
      await trx('roles').insert(missing);
      for (const role of missing) ids.set(role.key, role.id);
    }
    const permissions = Object.keys(inventoryPermissionRoles);
    const current = new Set((await trx('permissions').whereIn('key', permissions)
      .select('key')).map((row) => row.key));
    const additions = permissions.filter((key) => !current.has(key))
      .map((key) => ({ key, description: key }));
    if (additions.length) await trx('permissions').insert(additions);
    const assigned = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id').whereNull('r.organization_id')
      .whereIn('r.key', roleKeys).whereIn('rp.permission_key', permissions)
      .select('r.key as role_key', 'rp.permission_key'))
      .map((row) => `${row.role_key}\u0000${row.permission_key}`));
    const rows = [];
    for (const [permissionKey, roles] of Object.entries(inventoryPermissionRoles)) {
      for (const roleKey of roles) {
        if (!assigned.has(`${roleKey}\u0000${permissionKey}`)) {
          rows.push({ role_id: ids.get(roleKey), permission_key: permissionKey });
        }
      }
    }
    if (rows.length) await trx('role_permissions').insert(rows);
  });
}

export async function down() {
  throw new Error('WP12 inventory permissions migration is forward-only.');
}
