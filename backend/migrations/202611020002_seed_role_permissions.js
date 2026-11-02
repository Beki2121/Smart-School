import { createHash } from 'node:crypto';

export const seededPermissionRoles = {
  'dashboard.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'account.view': ['super_admin', 'owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin', 'student', 'parent_guardian', 'auditor'],
  'accounts.manage': ['owner_director', 'principal', 'registrar', 'hr_admin', 'system_admin'],
  'portal.view': ['student', 'parent_guardian'],
  'platform.view': ['super_admin'],
  'platform.manage': ['super_admin'],
  'audit.view': ['super_admin', 'owner_director', 'system_admin'],
  'session.manage': ['super_admin', 'owner_director', 'system_admin'],
  'school.branches.manage': ['owner_director'],
  'school.export': ['owner_director'],
  'school.close': ['owner_director'],
  'students.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'counsellor', 'system_admin'],
  'students.alumni.view': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.progression.override': ['owner_director', 'principal', 'system_admin'],
  'students.edit': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.sensitive.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.sensitive.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.discipline.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.discipline.manage': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'students.transfer.approve': ['owner_director', 'principal', 'system_admin'],
  'students.emergency.view': ['owner_director', 'principal', 'registrar', 'counsellor', 'system_admin'],
  'students.emergency.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.guardians.view': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.guardians.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'students.commendations.view': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'students.commendations.manage': ['owner_director', 'principal', 'counsellor', 'system_admin'],
  'admissions.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'admissions.manage': ['owner_director', 'principal', 'registrar', 'system_admin'],
  'school.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'school.edit': ['owner_director', 'principal', 'system_admin'],
  'lesson_plans.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'lesson_plans.manage': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.take': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.edit': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'attendance.corrections.review': ['owner_director', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'marks.view': ['owner_director', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.enter': ['owner_director', 'principal', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'system_admin'],
  'marks.approve': ['owner_director', 'principal', 'academic_head', 'system_admin'],
  'marks.publish': ['owner_director', 'principal', 'system_admin'],
  'marks.amend': ['owner_director', 'principal', 'system_admin'],
  'fees.view': ['owner_director', 'principal', 'registrar', 'accountant_cashier', 'system_admin'],
  'fees.manage': ['owner_director', 'principal', 'system_admin'],
  'fees.collect': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.reverse': ['owner_director', 'principal', 'system_admin'],
  'fees.shifts': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.expenses.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.expenses.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.reports.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'staff.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'staff.manage': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'assignments.manage': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'system_admin'],
  'staff.attendance': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.request': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'leave.approve': ['owner_director', 'principal', 'hr_admin', 'system_admin'],
  'staff.messages': ['owner_director', 'principal', 'academic_head', 'hr_admin', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'counsellor', 'system_admin'],
  'communications.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin'],
  'communications.manage': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'system_admin'],
  'notifications.view': ['owner_director', 'group_executive', 'principal', 'registrar', 'academic_head', 'homeroom_teacher', 'subject_teacher', 'accountant_cashier', 'hr_admin', 'counsellor', 'system_admin']
};

const roleKeys = [...new Set(Object.values(seededPermissionRoles).flat())].sort();
const permissionKeys = Object.keys(seededPermissionRoles).sort();

function systemRoleId(roleKey) {
  const bytes = createHash('sha256').update(`sims-system-role:${roleKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function roleName(roleKey) {
  return roleKey.split('_').map((part) =>
    `${part[0].toUpperCase()}${part.slice(1)}`).join(' ');
}

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const existingRoles = await trx('roles').whereNull('organization_id')
      .whereIn('key', roleKeys).select('id', 'key');
    const roleIds = new Map(existingRoles.map((row) => [row.key, row.id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key)).map((key) => ({
      id: systemRoleId(key), organization_id: null, key, name: roleName(key), is_system: true
    }));
    if (missingRoles.length) {
      await trx('roles').insert(missingRoles);
      for (const role of missingRoles) roleIds.set(role.key, role.id);
    }

    const existingPermissions = await trx('permissions').whereIn('key', permissionKeys)
      .select('key');
    const knownPermissions = new Set(existingPermissions.map((row) => row.key));
    const missingPermissions = permissionKeys.filter((key) => !knownPermissions.has(key))
      .map((key) => ({ key, description: key }));
    if (missingPermissions.length) await trx('permissions').insert(missingPermissions);

    const roleIdValues = [...roleIds.values()];
    const existingAssignments = await trx('role_permissions').whereIn('role_id', roleIdValues)
      .select('role_id', 'permission_key');
    const assigned = new Set(existingAssignments.map((row) =>
      `${row.role_id}:${row.permission_key}`));
    const missingAssignments = Object.entries(seededPermissionRoles).flatMap(
      ([permissionKey, roles]) => roles.map((roleKey) => ({
        role_id: roleIds.get(roleKey), permission_key: permissionKey
      }))
    ).filter((row) => !assigned.has(`${row.role_id}:${row.permission_key}`));
    if (missingAssignments.length) await trx('role_permissions').insert(missingAssignments);
  });
}

export async function down(knex) {
  await knex.transaction(async (trx) => {
    const seededRoleIds = roleKeys.map(systemRoleId);
    await trx('role_permissions').whereIn('role_id', seededRoleIds).delete();
    await trx('roles').whereNull('organization_id').whereIn('id', seededRoleIds).delete();
    await trx('permissions').whereIn('key', permissionKeys)
      .whereNotExists(function noRoleAssignments() {
        this.select(trx.raw('1')).from('role_permissions')
          .whereRaw('role_permissions.permission_key = permissions.key');
      }).delete();
  });
}
