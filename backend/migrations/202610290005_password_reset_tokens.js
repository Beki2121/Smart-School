export async function up(knex) {
  if (!await knex.schema.hasTable('password_reset_tokens')) {
    await knex.schema.createTable('password_reset_tokens', (table) => {
      table.string('id', 36).primary();
      table.string('user_id', 36).notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      table.string('token_hash', 64).notNullable().unique();
      table.timestamp('expires_at').notNullable();
      table.timestamp('consumed_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['user_id', 'expires_at'], 'password_reset_user_expiry_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('password_reset_tokens');
}
