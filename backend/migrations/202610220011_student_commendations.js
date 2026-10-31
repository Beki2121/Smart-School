export async function up(knex) {
  if (!await knex.schema.hasTable('student_commendations')) {
    await knex.schema.createTable('student_commendations', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
      table.date('recorded_on').notNullable();
      table.string('title_en', 180).notNullable();
      table.string('title_am', 180).notNullable();
      table.text('description_en').notNullable();
      table.text('description_am').notNullable();
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.index(['campus_id', 'student_id', 'recorded_on'], 'student_commendation_date_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('student_commendations');
}
