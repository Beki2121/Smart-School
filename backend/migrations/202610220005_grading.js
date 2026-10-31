export async function up(knex) {
  if (await knex.schema.hasTable('marks')) {
    if (!await knex.schema.hasColumn('marks', 'term_id')) {
      await knex.schema.alterTable('marks', (table) => {
        table.string('term_id', 36).nullable().references('id').inTable('terms').onDelete('RESTRICT');
      });
    }
    if (!await knex.schema.hasColumn('marks', 'subject_id')) {
      await knex.schema.alterTable('marks', (table) => {
        table.string('subject_id', 36).nullable().references('id').inTable('subjects').onDelete('RESTRICT');
      });
    }
    await knex.schema.alterTable('marks', (table) => {
      table.index(['campus_id', 'term_id', 'student_id'], 'marks_term_student_idx');
    });
  }
  if (!await knex.schema.hasTable('grading_bands')) {
    await knex.schema.createTable('grading_bands', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('code', 24).notNullable();
      table.string('name_en', 80).notNullable();
      table.string('name_am', 80).notNullable();
      table.decimal('min_percent', 5, 2).unsigned().notNullable();
      table.timestamps(true, true);
      table.unique(['campus_id', 'code'], 'grading_band_code_uq');
      table.unique(['campus_id', 'min_percent'], 'grading_band_min_uq');
      table.index(['campus_id', 'min_percent'], 'grading_band_order_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('grading_bands');
  if (await knex.schema.hasColumn('marks', 'subject_id')) {
    await knex.schema.alterTable('marks', (table) => {
      table.dropForeign(['subject_id']);
      table.dropColumn('subject_id');
    });
  }
  if (await knex.schema.hasColumn('marks', 'term_id')) {
    await knex.schema.alterTable('marks', (table) => {
      table.dropIndex(['campus_id', 'term_id', 'student_id'], 'marks_term_student_idx');
      table.dropForeign(['term_id']);
      table.dropColumn('term_id');
    });
  }
}
