export async function up(knex) {
  if (!await knex.schema.hasTable('campus_academic_policies')) {
    await knex.schema.createTable('campus_academic_policies', (table) => {
      table.string('campus_id', 36).primary().references('id').inTable('campuses').onDelete('RESTRICT');
      table.enu('scoring_method', ['points_weighted', 'equal_subject_weighted'])
        .notNullable().defaultTo('points_weighted');
      table.string('confirmed_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('confirmed_at').nullable();
      table.timestamps(true, true);
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('campus_academic_policies');
}
