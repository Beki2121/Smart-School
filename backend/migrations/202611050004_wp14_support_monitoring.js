export async function up(knex) {
  if (!await knex.schema.hasTable('support_tickets')) await knex.schema.createTable('support_tickets', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.enu('ticket_type', ['platform', 'internal']).notNullable();
    table.string('subject', 180).notNullable();
    table.string('category', 60).notNullable();
    table.enu('priority', ['low', 'normal', 'high', 'urgent']).notNullable().defaultTo('normal');
    table.enu('status', ['open', 'in_progress', 'waiting_school', 'resolved']).notNullable().defaultTo('open');
    table.string('created_by', 36).notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.string('assigned_to', 36).nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.dateTime('resolved_at').nullable();
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'ticket_type', 'status', 'created_at'],
      'support_ticket_scope_type_status_idx');
    table.index(['ticket_type', 'status', 'priority', 'created_at'],
      'support_ticket_queue_idx');
  });

  if (!await knex.schema.hasTable('support_ticket_comments')) await knex.schema.createTable('support_ticket_comments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('ticket_id', 36).notNullable()
      .references('id').inTable('support_tickets').onDelete('RESTRICT');
    table.string('author_id', 36).notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.boolean('is_internal').notNullable().defaultTo(false);
    table.text('body').notNullable();
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'ticket_id', 'created_at'],
      'support_comment_scope_ticket_idx');
  });

  if (!await knex.schema.hasTable('support_ticket_attachments')) await knex.schema.createTable('support_ticket_attachments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('ticket_id', 36).notNullable()
      .references('id').inTable('support_tickets').onDelete('RESTRICT');
    table.string('uploaded_by', 36).notNullable()
      .references('id').inTable('users').onDelete('RESTRICT');
    table.string('original_name', 255).notNullable();
    table.string('mime_type', 120).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('sha256', 64).notNullable();
    table.longblob('content').notNullable();
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'ticket_id'],
      'support_attachment_scope_ticket_idx');
  });

  if (!await knex.schema.hasTable('system_backup_runs')) await knex.schema.createTable('system_backup_runs', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).nullable()
      .references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).nullable()
      .references('id').inTable('campuses').onDelete('RESTRICT');
    table.dateTime('started_at').notNullable();
    table.dateTime('completed_at').nullable();
    table.enu('status', ['running', 'succeeded', 'failed']).notNullable();
    table.bigInteger('size_bytes').unsigned().nullable();
    table.string('artifact_name', 255).nullable();
    table.string('error_code', 80).nullable();
    table.index(['status', 'started_at'], 'system_backup_status_started_idx');
  });
}

export async function down() {
  throw new Error('WP14 support and monitoring migration is forward-only.');
}
