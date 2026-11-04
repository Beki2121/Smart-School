import { createHash } from 'node:crypto';

export const payrollPermissionRoles = {
  'payroll.structures.view': ['payroll_officer', 'owner_director', 'principal', 'system_admin'],
  'payroll.structures.manage': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.periods.manage': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.inputs.manage': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.run.view': ['payroll_officer', 'owner_director', 'principal', 'system_admin'],
  'payroll.run.calculate': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.run.submit': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.run.approve': ['owner_director', 'principal', 'system_admin'],
  'payroll.run.lock': ['owner_director', 'principal', 'system_admin'],
  'payroll.payments.manage': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.payslips.view': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.payslips.generate': ['payroll_officer', 'owner_director', 'system_admin'],
  'payroll.reports.view': ['payroll_officer', 'owner_director', 'principal', 'system_admin'],
  'payroll.net.override': ['owner_director', 'system_admin']
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
    const roleKeys = [...new Set(Object.values(payrollPermissionRoles).flat())];
    const existingRoles = await trx('roles').whereNull('organization_id')
      .whereIn('key', roleKeys).select('id', 'key');
    const roleIds = new Map(existingRoles.map(({ id, key }) => [key, id]));
    const missingRoles = roleKeys.filter((key) => !roleIds.has(key)).map((key) => ({
      id: systemRoleId(key),
      organization_id: null,
      key,
      name: key.split('_').map((part) =>
        `${part[0].toUpperCase()}${part.slice(1)}`).join(' '),
      is_system: true
    }));
    if (missingRoles.length) {
      await trx('roles').insert(missingRoles);
      for (const role of missingRoles) roleIds.set(role.key, role.id);
    }

    const permissionKeys = Object.keys(payrollPermissionRoles);
    const existingPermissions = new Set((await trx('permissions')
      .whereIn('key', permissionKeys).select('key')).map(({ key }) => key));
    const missingPermissions = permissionKeys.filter((key) => !existingPermissions.has(key))
      .map((key) => ({ key, description: key }));
    if (missingPermissions.length) await trx('permissions').insert(missingPermissions);

    const assignments = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id')
      .whereNull('r.organization_id').whereIn('r.key', roleKeys)
      .whereIn('rp.permission_key', permissionKeys)
      .select('r.key as role_key', 'rp.permission_key'))
      .map(({ role_key, permission_key }) => `${role_key}\u0000${permission_key}`));
    const additions = [];
    for (const [permissionKey, assignedRoles] of Object.entries(payrollPermissionRoles)) {
      for (const roleKey of assignedRoles) {
        if (!assignments.has(`${roleKey}\u0000${permissionKey}`)) {
          additions.push({ role_id: roleIds.get(roleKey), permission_key: permissionKey });
        }
      }
    }
    if (additions.length) await trx('role_permissions').insert(additions);
  });
}

export async function down() {
  throw new Error('WP10 payroll permission migration is forward-only.');
}
