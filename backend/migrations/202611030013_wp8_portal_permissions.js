export const portalExtensionPermissionRoles = {
  'portal.calendar.view': ['student', 'parent_guardian'],
  'portal.requests.create': ['student', 'parent_guardian'],
  'portal.requests.view': [
    'student', 'parent_guardian', 'owner_director', 'principal', 'registrar', 'system_admin'
  ],
  'portal.requests.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'portal.support.create': ['student'],
  'portal.support.view': [
    'student', 'owner_director', 'principal', 'academic_head', 'registrar',
    'homeroom_teacher', 'subject_teacher', 'system_admin'
  ],
  'portal.support.manage': [
    'owner_director', 'principal', 'academic_head', 'registrar', 'system_admin'
  ],
  'portal.messaging.view': [
    'parent_guardian', 'homeroom_teacher', 'subject_teacher', 'owner_director',
    'principal', 'academic_head', 'registrar', 'system_admin'
  ],
  'portal.messaging.send': [
    'parent_guardian', 'homeroom_teacher', 'subject_teacher', 'owner_director',
    'principal', 'academic_head', 'registrar', 'system_admin'
  ],
  'portal.messaging.moderate': ['owner_director', 'principal', 'system_admin'],
  'portal.messaging.configure': ['owner_director', 'principal', 'system_admin'],
  'notifications.view': [
    'owner_director', 'group_executive', 'principal', 'registrar', 'academic_head',
    'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor',
    'system_admin', 'student', 'parent_guardian'
  ]
};

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(portalExtensionPermissionRoles).flat())];
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key));
    if (missingRoles.length) {
      throw new Error(`WP8 permission seed is missing system roles: ${missingRoles.join(', ')}`);
    }

    const permissionKeys = Object.keys(portalExtensionPermissionRoles);
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
    for (const [permissionKey, assignedRoles] of Object.entries(portalExtensionPermissionRoles)) {
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
  throw new Error('WP8 portal permissions are forward-only.');
}
