export async function up(knex) {
  if (!await knex.schema.hasColumn('students', 'user_id')) {
    await knex.schema.alterTable('students', (table) => {
      table.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL').unique();
    });
  }
  if (!await knex.schema.hasColumn('guardians', 'user_id')) {
    await knex.schema.alterTable('guardians', (table) => {
      table.string('user_id', 36).nullable().references('id').inTable('users').onDelete('SET NULL').unique();
    });
  }
  if (!await knex.schema.hasTable('account_invitations')) {
    await knex.schema.createTable('account_invitations', (table) => {
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('email', 254).notNullable();
      table.string('role', 40).notNullable();
      table.string('target_type', 16).notNullable();
      table.string('target_id', 36).notNullable();
      table.string('token_hash', 64).notNullable().unique();
      table.timestamp('expires_at').notNullable();
      table.timestamp('accepted_at').nullable();
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.index(['organization_id', 'campus_id', 'target_type', 'target_id'], 'account_invitation_target_idx');
      table.index(['email', 'expires_at', 'accepted_at'], 'account_invitation_email_idx');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('account_invitations')) {
    await knex.schema.dropTable('account_invitations');
  }
  if (await knex.schema.hasColumn('guardians', 'user_id')) {
    await knex.schema.alterTable('guardians', (table) => table.dropColumn('user_id'));
  }
  if (await knex.schema.hasColumn('students', 'user_id')) {
    await knex.schema.alterTable('students', (table) => table.dropColumn('user_id'));
  }
}
