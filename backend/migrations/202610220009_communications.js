export async function up(knex) {
  if (!await knex.schema.hasTable('campus_announcements')) {
    await knex.schema.createTable('campus_announcements', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('title_en', 180).notNullable();
      table.string('title_am', 180).notNullable();
      table.text('body_en').notNullable();
      table.text('body_am').notNullable();
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('published_at').notNullable().defaultTo(knex.fn.now());
      table.timestamps(true, true);
      table.index(['campus_id', 'published_at'], 'announcement_publish_idx');
    });
  }
  if (!await knex.schema.hasTable('campus_events')) {
    await knex.schema.createTable('campus_events', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('title_en', 180).notNullable();
      table.string('title_am', 180).notNullable();
      table.text('description_en').notNullable();
      table.text('description_am').notNullable();
      table.date('starts_on').notNullable();
      table.date('ends_on').notNullable();
      table.time('starts_at').nullable();
      table.time('ends_at').nullable();
      table.string('location', 180).notNullable().defaultTo('');
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.index(['campus_id', 'starts_on', 'ends_on'], 'campus_event_dates_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('campus_events');
  await knex.schema.dropTableIfExists('campus_announcements');
}
