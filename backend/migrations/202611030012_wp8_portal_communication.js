async function addColumn(knex, tableName, column, define) {
  if (!await knex.schema.hasColumn(tableName, column)) {
    await knex.schema.alterTable(tableName, define);
  }
}

async function hasIndex(knex, tableName, name) {
  const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [tableName, name]);
  return rows.length > 0;
}

async function hasForeignKey(knex, tableName, columnName, referencedTable) {
  const [rows] = await knex.raw(
    `SELECT 1
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME = ?
      LIMIT 1`,
    [tableName, columnName, referencedTable]
  );
  return rows.length > 0;
}

async function addForeignKey(knex, tableName, columnName, referencedTable, onDelete) {
  if (await hasForeignKey(knex, tableName, columnName, referencedTable)) return;
  await knex.schema.alterTable(tableName, (table) => {
    table.foreign(columnName, `wp8_${tableName}_${columnName}_fk`)
      .references('id').inTable(referencedTable).onDelete(onDelete);
  });
}

export async function up(knex) {
  await addColumn(knex, 'organizations', 'messaging_enabled', (table) => {
    table.boolean('messaging_enabled').notNullable().defaultTo(true);
  });
  await addColumn(knex, 'campus_announcements', 'organization_id', (table) =>
    table.string('organization_id', 36).nullable());
  await addColumn(knex, 'campus_announcements', 'audience', (table) =>
    table.string('audience', 24).notNullable().defaultTo('school'));
  await addColumn(knex, 'campus_announcements', 'section_id', (table) =>
    table.string('section_id', 36).nullable());
  await addColumn(knex, 'campus_events', 'organization_id', (table) =>
    table.string('organization_id', 36).nullable());
  await addColumn(knex, 'campus_events', 'event_type', (table) =>
    table.string('event_type', 32).notNullable().defaultTo('school'));
  await addColumn(knex, 'campus_events', 'audience', (table) =>
    table.string('audience', 24).notNullable().defaultTo('school'));
  await addColumn(knex, 'campus_events', 'status', (table) =>
    table.string('status', 24).notNullable().defaultTo('published'));
  await addColumn(knex, 'campus_events', 'section_id', (table) =>
    table.string('section_id', 36).nullable());

  if (knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql') {
    await knex.raw('ALTER TABLE `campus_events` MODIFY `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  }
  await knex('campus_announcements').whereNull('organization_id').update({
    organization_id: knex.raw('(SELECT organization_id FROM campuses WHERE campuses.id = campus_announcements.campus_id)')
  });
  await knex('campus_events').whereNull('organization_id').update({
    organization_id: knex.raw('(SELECT organization_id FROM campuses WHERE campuses.id = campus_events.campus_id)')
  });
  if (knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql') {
    await knex.schema.alterTable('campus_announcements', (table) => {
      table.string('organization_id', 36).notNullable().alter();
      table.string('section_id', 36).nullable().alter();
    });
    await knex.schema.alterTable('campus_events', (table) => {
      table.string('organization_id', 36).notNullable().alter();
      table.string('section_id', 36).nullable().alter();
    });
    await addForeignKey(knex, 'campus_announcements', 'organization_id', 'organizations', 'RESTRICT');
    await addForeignKey(knex, 'campus_announcements', 'section_id', 'sections', 'SET NULL');
    await addForeignKey(knex, 'campus_events', 'organization_id', 'organizations', 'RESTRICT');
    await addForeignKey(knex, 'campus_events', 'section_id', 'sections', 'SET NULL');
  }
  if (!await hasIndex(knex, 'campus_announcements', 'wp8_announcement_scope_idx')) {
    await knex.schema.alterTable('campus_announcements', (table) => {
      table.index(['organization_id', 'campus_id', 'audience'], 'wp8_announcement_scope_idx');
    });
  }
  if (!await hasIndex(knex, 'campus_events', 'wp8_event_scope_idx')) {
    await knex.schema.alterTable('campus_events', (table) => {
      table.index(['organization_id', 'campus_id', 'status'], 'wp8_event_scope_idx');
    });
  }

  if (!await knex.schema.hasTable('portal_requests')) await knex.schema.createTable('portal_requests', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('requester_id', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('type', 32).notNullable();
    table.string('subject', 180).notNullable();
    table.text('details').notNullable();
    table.string('status', 24).notNullable().defaultTo('pending');
    table.string('handled_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.text('response').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('status_changed_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'status'], 'wp8_request_status_idx');
    table.index(['requester_id', 'campus_id', 'created_at'], 'wp8_request_owner_idx');
  });

  if (!await knex.schema.hasTable('support_requests')) await knex.schema.createTable('support_requests', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('requester_id', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('student_id', 36).nullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('category', 24).notNullable();
    table.string('subject', 180).notNullable();
    table.text('details').notNullable();
    table.string('status', 24).notNullable().defaultTo('open');
    table.string('assigned_to', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.text('response').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('status_changed_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'status'], 'wp8_support_status_idx');
    table.index(['requester_id', 'campus_id', 'created_at'], 'wp8_support_owner_idx');
  });

  if (!await knex.schema.hasTable('message_threads')) await knex.schema.createTable('message_threads', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
    table.string('thread_key', 64).notNullable().unique('wp8_thread_key_uq');
    table.string('status', 24).notNullable().defaultTo('open');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['student_id', 'id'], 'wp8_thread_student_id_uq');
    table.index(['organization_id', 'campus_id', 'status'], 'wp8_thread_scope_status_idx');
  });

  if (!await knex.schema.hasTable('thread_participants')) await knex.schema.createTable('thread_participants', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('thread_id', 36).notNullable().references('id').inTable('message_threads').onDelete('CASCADE');
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('role', 32).notNullable();
    table.timestamp('read_at').nullable().defaultTo(null);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['thread_id', 'user_id']);
    table.index(['organization_id', 'campus_id', 'user_id', 'read_at'], 'wp8_participant_inbox_idx');
  });

  if (!await knex.schema.hasTable('messages')) await knex.schema.createTable('messages', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('thread_id', 36).notNullable().references('id').inTable('message_threads').onDelete('CASCADE');
    table.string('sender_id', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.text('body').notNullable();
    table.string('status', 24).notNullable().defaultTo('visible');
    table.string('moderated_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('sent_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('moderated_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'thread_id', 'sent_at'], 'wp8_message_thread_idx');
  });
}

export async function down() {
  throw new Error('WP8 portal and communication migration is forward-only.');
}
