export async function up(knex) {
  const [constraints] = await knex.raw(`SELECT CONSTRAINT_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'support_ticket_attachments'
      AND COLUMN_NAME = 'ticket_id'
      AND REFERENCED_TABLE_NAME = 'support_tickets'
    LIMIT 1`);
  if (constraints.length) return;

  await knex.schema.alterTable('support_ticket_attachments', (table) => {
    table.foreign('ticket_id', 'support_attachment_ticket_fk')
      .references('id').inTable('support_tickets').onDelete('RESTRICT');
  });
}

export async function down() {
  throw new Error('WP14 support attachment foreign key migration is forward-only.');
}
