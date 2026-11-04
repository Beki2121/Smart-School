export const frontDeskAuthorizationReadPermissionRoles = {
  'frontdesk.pickup.authorizations.view': [
    'receptionist', 'owner_director', 'principal', 'system_admin'
  ]
};

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const permissionKey = 'frontdesk.pickup.authorizations.view';
    const roleKeys = frontDeskAuthorizationReadPermissionRoles[permissionKey];
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key));
    if (missingRoles.length) {
      throw new Error(`WP13 authorization-read permission is missing system roles: ${missingRoles.join(', ')}`);
    }

    const permissionExists = await trx('permissions').where({ key: permissionKey }).first('key');
    if (!permissionExists) await trx('permissions').insert({ key: permissionKey, description: permissionKey });
    const assigned = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereNull('r.organization_id')
      .whereIn('r.key', roleKeys)
      .where('rp.permission_key', permissionKey)
      .select('r.key as role_key'))
      .map((row) => row.role_key));
    const rows = roleKeys.filter((key) => !assigned.has(key))
      .map((key) => ({ role_id: roleIds.get(key), permission_key: permissionKey }));
    if (rows.length) await trx('role_permissions').insert(rows);
  });
}

export async function down() {
  throw new Error('WP13 pickup authorization read permission migration is forward-only.');
}
