import { createHash } from 'node:crypto';

export const wp14AdditionalPermissionRoles = {
  'support.internal.create': ['system_admin'],
  'support.platform.view': ['super_admin', 'support_staff'],
  'support.platform.manage': ['super_admin', 'support_staff'],
  'support.platform.notes': ['super_admin', 'support_staff'],
  'platform.backups.record': ['super_admin'],
  'integrations.email.verify': ['system_admin']
};

function systemRoleId(roleKey) {
  const bytes = createHash('sha256').update(`sims-system-role:${roleKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function up(knex) {
  await knex.raw(`ALTER TABLE support_tickets MODIFY status
    ENUM('open', 'assigned', 'in_progress', 'waiting_on_school', 'resolved', 'closed')
    NOT NULL DEFAULT 'open'`);

  if (!await knex.schema.hasColumn('system_backup_runs', 'kind')) {
    await knex.schema.alterTable('system_backup_runs', (table) => {
      table.string('kind', 40).notNullable().defaultTo('database');
    });
  }
  if (!await knex.schema.hasColumn('users', 'email_verified_at')) {
    await knex.schema.alterTable('users', (table) => {
      table.dateTime('email_verified_at').nullable();
    });
  }
  if (!await knex.schema.hasTable('user_email_verification_tokens')) {
    await knex.schema.createTable('user_email_verification_tokens', (table) => {
      table.collate('utf8mb4_general_ci');
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('campus_id', 36).notNullable()
        .references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('user_id', 36).notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.string('token_hash', 64).notNullable().unique();
      table.dateTime('expires_at').notNullable();
      table.dateTime('used_at').nullable();
      table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['organization_id', 'user_id', 'expires_at'], 'email_verify_user_expiry_idx');
    });
  }
  if (!await knex.schema.hasTable('email_integration_tests')) {
    await knex.schema.createTable('email_integration_tests', (table) => {
      table.collate('utf8mb4_general_ci');
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('campus_id', 36).notNullable()
        .references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('requested_by', 36).notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      table.enu('result', ['succeeded', 'failed']).notNullable();
      table.string('error_code', 80).nullable();
      table.dateTime('tested_at').notNullable();
      table.index(['organization_id', 'tested_at'], 'email_integration_test_org_date_idx');
    });
  }

  await knex.transaction(async (trx) => {
    const roleKeys = [...new Set(Object.values(wp14AdditionalPermissionRoles).flat())];
    const roles = await trx('roles').whereNull('organization_id')
      .whereIn('key', [...roleKeys, 'support_staff']).select('id', 'key');
    const roleIds = new Map(roles.map((role) => [role.key, role.id]));
    if (!roleIds.has('support_staff')) {
      const supportStaff = {
        id: systemRoleId('support_staff'), organization_id: null, key: 'support_staff',
        name: 'Support Staff', is_system: true
      };
      await trx('roles').insert(supportStaff);
      roleIds.set(supportStaff.key, supportStaff.id);
    }

    const permissions = Object.keys(wp14AdditionalPermissionRoles);
    const existing = new Set((await trx('permissions').whereIn('key', permissions)
      .select('key')).map((row) => row.key));
    const missing = permissions.filter((key) => !existing.has(key))
      .map((key) => ({ key, description: key }));
    if (missing.length) await trx('permissions').insert(missing);

    const assigned = new Set((await trx('role_permissions as rp')
      .join('roles as r', 'r.id', 'rp.role_id').whereNull('r.organization_id')
      .whereIn('r.key', roleKeys).whereIn('rp.permission_key', permissions)
      .select('r.key as role_key', 'rp.permission_key'))
      .map((row) => `${row.role_key}\u0000${row.permission_key}`));
    const grants = [];
    for (const [permission, allowedRoles] of Object.entries(wp14AdditionalPermissionRoles)) {
      for (const role of allowedRoles) {
        if (!assigned.has(`${role}\u0000${permission}`)) {
          grants.push({ role_id: roleIds.get(role), permission_key: permission });
        }
      }
    }
    if (grants.length) await trx('role_permissions').insert(grants);

  });
}

export async function down() {
  throw new Error('WP14 lifecycle and integrations migration is forward-only.');
}
