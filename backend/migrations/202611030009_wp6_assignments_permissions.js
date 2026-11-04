export const assignmentPermissionRoles = {
  'assignments.manage': [
    'owner_director', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'
  ],
  'assignments.view': ['owner_director', 'principal', 'academic_head', 'system_admin'],
  'assignments.submit': ['student'],
  'assignments.view_child': ['parent_guardian']
};

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(assignmentPermissionRoles).flat())];
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key));
    if (missingRoles.length) {
      throw new Error(`WP6 permission seed is missing system roles: ${missingRoles.join(', ')}`);
    }

    const permissionKeys = Object.keys(assignmentPermissionRoles);
    const disallowedRoles = await trx('roles').whereNull('organization_id')
      .whereNotIn('key', assignmentPermissionRoles['assignments.manage']).pluck('id');
    if (disallowedRoles.length) {
      await trx('role_permissions').whereIn('role_id', disallowedRoles)
        .where('permission_key', 'assignments.manage').delete();
    }
    const existing = new Set((await trx('permissions').whereIn('key', permissionKeys)
      .select('key')).map((permission) => permission.key));
    const missingPermissions = permissionKeys.filter((key) => !existing.has(key))
      .map((key) => ({ key, description: key }));
    if (missingPermissions.length) await trx('permissions').insert(missingPermissions);

    const existingAssignments = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereNull('r.organization_id').whereIn('r.key', roleKeys)
      .whereIn('rp.permission_key', permissionKeys)
      .select('r.key as role_key', 'rp.permission_key'))
      .map((row) => `${row.role_key}\u0000${row.permission_key}`));
    const assignments = [];
    for (const [permissionKey, assignedRoles] of Object.entries(assignmentPermissionRoles)) {
      for (const roleKey of assignedRoles) {
        const key = `${roleKey}\u0000${permissionKey}`;
        if (!existingAssignments.has(key)) {
          assignments.push({ role_id: roleIds.get(roleKey), permission_key: permissionKey });
        }
      }
    }
    if (assignments.length) await trx('role_permissions').insert(assignments);
  });
}

export async function down() {
  throw new Error('WP6 assignment permissions migration is forward-only.');
}
