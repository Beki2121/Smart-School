export const reportPermissionRoles = {
  'reports.students.view': [
    'owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
    'subject_teacher', 'system_admin'
  ],
  'reports.admissions.view': [
    'owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'
  ],
  'reports.attendance.view': [
    'owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher',
    'subject_teacher', 'system_admin'
  ],
  'reports.academics.view': [
    'owner_director', 'principal', 'academic_head', 'homeroom_teacher',
    'subject_teacher', 'system_admin'
  ],
  'reports.finance.view': [
    'owner_director', 'principal', 'accountant_cashier', 'system_admin'
  ],
  'reports.hr.view': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'reports.operations.view': ['owner_director', 'principal', 'system_admin']
};

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(reportPermissionRoles).flat())];
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key));
    if (missingRoles.length) {
      throw new Error(`WP7 permission seed is missing system roles: ${missingRoles.join(', ')}`);
    }

    const permissionKeys = Object.keys(reportPermissionRoles);
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
    for (const [permissionKey, assignedRoles] of Object.entries(reportPermissionRoles)) {
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
  throw new Error('WP7 report permissions are forward-only.');
}
