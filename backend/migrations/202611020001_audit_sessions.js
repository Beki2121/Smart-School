export async function up(knex) {
  await knex.schema.createTable('auth_sessions', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('organization_id', 36).nullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable().references('id').inTable('campuses').onDelete('SET NULL');
    table.string('ip_address', 45).nullable();
    table.string('user_agent', 512).nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_seen_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.index(['organization_id', 'campus_id', 'expires_at']);
    table.index(['user_id', 'revoked_at', 'expires_at']);
  });
  await knex.schema.alterTable('refresh_tokens', (table) => {
    table.string('session_id', 36).nullable()
      .references('id').inTable('auth_sessions').onDelete('CASCADE');
    table.index(['session_id', 'revoked_at', 'expires_at']);
  });
  await knex.schema.alterTable('audit_log', (table) => {
    table.index(['action', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('audit_log', (table) => table.dropIndex(['action', 'created_at']));
  await knex.schema.alterTable('refresh_tokens', (table) => {
    table.dropIndex(['session_id', 'revoked_at', 'expires_at']);
    table.dropForeign(['session_id']);
    table.dropColumn('session_id');
  });
  await knex.schema.dropTableIfExists('auth_sessions');
}
