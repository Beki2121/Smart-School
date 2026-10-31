export async function up(knex) {
  if (!await knex.schema.hasTable('user_notifications')) {
    await knex.schema.createTable('user_notifications', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.string('source_type', 32).notNullable();
      table.string('source_id', 36).notNullable();
      table.string('title_en', 180).notNullable();
      table.string('title_am', 180).notNullable();
      table.text('body_en').notNullable();
      table.text('body_am').notNullable();
      table.timestamp('read_at').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['user_id', 'source_type', 'source_id'], 'user_notification_source_uq');
      table.index(['campus_id', 'user_id', 'created_at'], 'user_notification_inbox_idx');
      table.index(['user_id', 'read_at'], 'user_notification_unread_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_notifications');
}
