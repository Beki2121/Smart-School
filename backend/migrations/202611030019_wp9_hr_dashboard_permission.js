export const hrDashboardPermissionRoles = {
  'hr.dashboard.view': ['hr_admin', 'owner_director', 'principal', 'system_admin']
};

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(hrDashboardPermissionRoles).flat())];
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key));
    if (missingRoles.length) throw new Error(
      `WP9 dashboard permission seed is missing system roles: ${missingRoles.join(', ')}`
    );
    const permissionKeys = Object.keys(hrDashboardPermissionRoles);
    const existing = new Set((await trx('permissions').whereIn('key', permissionKeys)
      .select('key')).map((permission) => permission.key));
    const missing = permissionKeys.filter((key) => !existing.has(key))
      .map((key) => ({ key, description: key }));
    if (missing.length) await trx('permissions').insert(missing);

    const assigned = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereNull('r.organization_id').whereIn('r.key', roleKeys)
      .whereIn('rp.permission_key', permissionKeys)
      .select('r.key as role_key', 'rp.permission_key'))
      .map((row) => `${row.role_key}\u0000${row.permission_key}`));
    const additions = [];
    for (const [permissionKey, assignedRoles] of Object.entries(hrDashboardPermissionRoles)) {
      for (const roleKey of assignedRoles) {
        if (!assigned.has(`${roleKey}\u0000${permissionKey}`)) {
          additions.push({ role_id: roleIds.get(roleKey), permission_key: permissionKey });
        }
      }
    }
    if (additions.length) await trx('role_permissions').insert(additions);
  });
}

export async function down() {
  throw new Error('WP9 HR migrations are forward-only.');
}
