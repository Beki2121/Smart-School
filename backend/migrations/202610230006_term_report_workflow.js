export async function up(knex) {
  if (!await knex.schema.hasTable('term_report_revisions')) {
    await knex.schema.createTable('term_report_revisions', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
      table.string('term_id', 36).notNullable().references('id').inTable('terms').onDelete('RESTRICT');
      table.integer('revision').unsigned().notNullable();
      table.enu('status', ['draft', 'submitted', 'approved', 'published']).notNullable().defaultTo('draft');
      table.json('report_json').notNullable();
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('submitted_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('approved_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('published_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('submitted_at').nullable();
      table.timestamp('approved_at').nullable();
      table.timestamp('published_at').nullable();
      table.timestamps(true, true);
      table.unique(['campus_id', 'student_id', 'term_id', 'revision'], 'term_report_revision_uq');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('term_report_revisions');
}
