export async function up(knex) {
  if (await knex.schema.hasTable('support_ticket_attachments')) return;

  await knex.schema.createTable('support_ticket_attachments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('ticket_id', 36).notNullable();
    table.string('uploaded_by', 36).notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.string('original_name', 255).notNullable();
    table.string('mime_type', 120).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('sha256', 64).notNullable();
    table.specificType('content', 'LONGBLOB').notNullable();
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'ticket_id'],
      'support_attachment_scope_ticket_idx');
  });
}

export async function down() {
  throw new Error('WP14 support attachment storage migration is forward-only.');
}
