const notificationRoles = [
  'student', 'parent_guardian'
];

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roles = await trx('roles').whereNull('organization_id')
      .whereIn('key', notificationRoles).select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = notificationRoles.filter((key) => !roleIds.has(key));
    if (missingRoles.length) {
      throw new Error(`WP8 notification seed is missing system roles: ${missingRoles.join(', ')}`);
    }

    const permission = await trx('permissions').where({ key: 'notifications.view' }).first('key');
    if (!permission) throw new Error('The notification view permission must be seeded before WP8.');
    const existing = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereNull('r.organization_id').whereIn('r.key', notificationRoles)
      .where('rp.permission_key', 'notifications.view').select('r.key'))
      .map((row) => row.key));
    const assignments = notificationRoles.filter((role) => !existing.has(role))
      .map((role) => ({ role_id: roleIds.get(role), permission_key: 'notifications.view' }));
    if (assignments.length) await trx('role_permissions').insert(assignments);
  });
}

export async function down() {
  throw new Error('WP8 portal notifications permissions are forward-only.');
}
