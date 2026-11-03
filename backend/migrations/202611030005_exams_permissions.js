export const examPermissionRoles = {
  'exams.view': [
    'owner_director', 'principal', 'registrar', 'academic_head',
    'homeroom_teacher', 'subject_teacher', 'student', 'parent_guardian'
  ],
  'exams.manage': ['owner_director', 'principal', 'academic_head'],
  'exams.schedule.manage': ['owner_director', 'principal', 'academic_head'],
  'exams.monitor': [
    'owner_director', 'principal', 'registrar', 'academic_head',
    'homeroom_teacher', 'subject_teacher'
  ]
};

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(examPermissionRoles).flat())];
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key));
    if (missingRoles.length) {
      throw new Error(`WP4 permission seed is missing system roles: ${missingRoles.join(', ')}`);
    }

    const permissionKeys = Object.keys(examPermissionRoles);
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
    for (const [permissionKey, assignedRoles] of Object.entries(examPermissionRoles)) {
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

export async function down(knex) {
  await knex.transaction(async (trx) => {
    const permissionKeys = Object.keys(examPermissionRoles);
    const roleKeys = [...new Set(Object.values(examPermissionRoles).flat())];
    const rows = await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereNull('r.organization_id').whereIn('r.key', roleKeys)
      .whereIn('rp.permission_key', permissionKeys)
      .select('rp.role_id', 'rp.permission_key');
    for (const row of rows) {
      await trx('role_permissions').where(row).delete();
    }
    await trx('permissions').whereIn('key', permissionKeys).delete();
  });
}
