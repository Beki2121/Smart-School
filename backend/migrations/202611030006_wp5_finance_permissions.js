import { createHash } from 'node:crypto';

export const financePermissionRoles = {
  'fees.portal.view': ['student', 'parent_guardian'],
  'fees.structure.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.discount.request': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.discount.approve': ['principal'],
  'fees.refund.request': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.refund.approve': ['principal'],
  'fees.adjustment.request': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.adjustment.approve': ['principal'],
  'fees.arrears.view': ['owner_director', 'principal', 'accountant_cashier', 'system_admin'],
  'fees.cashbook.manage': ['owner_director', 'principal', 'accountant_cashier', 'system_admin']
};

const roleKeys = [...new Set(Object.values(financePermissionRoles).flat())];
const permissionKeys = Object.keys(financePermissionRoles);

function systemRoleId(roleKey) {
  const bytes = createHash('sha256').update(`sims-system-role:${roleKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function up(knex) {
  await knex.transaction(async (trx) => {
    const roles = await trx('roles').whereNull('organization_id').whereIn('key', roleKeys)
      .select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    const missingPermissions = await trx('permissions').whereIn('key', permissionKeys)
      .select('key');
    const existing = new Set(missingPermissions.map((item) => item.key));
    const toInsert = permissionKeys.filter((key) => !existing.has(key))
      .map((key) => ({ key, description: key }));
    if (toInsert.length) await trx('permissions').insert(toInsert);
    const assignments = [];
    for (const [permissionKey, assignedRoles] of Object.entries(financePermissionRoles)) {
      for (const roleKey of assignedRoles) {
        const roleId = roleIds.get(roleKey);
        if (!roleId) throw new Error(`Finance permission seed is missing system role ${roleKey}.`);
        const present = await trx('role_permissions').where({
          role_id: roleId, permission_key: permissionKey
        }).first('role_id');
        if (!present) assignments.push({ role_id: roleId, permission_key: permissionKey });
      }
    }
    if (assignments.length) await trx('role_permissions').insert(assignments);
  });
}

export async function down(knex) {
  await knex.transaction(async (trx) => {
    await trx('role_permissions').whereIn('permission_key', permissionKeys).delete();
    await trx('permissions').whereIn('key', permissionKeys)
      .whereNotExists(function noRoleAssignments() {
        this.select(trx.raw('1')).from('role_permissions')
          .whereRaw('role_permissions.permission_key = permissions.key');
      }).delete();
  });
}
