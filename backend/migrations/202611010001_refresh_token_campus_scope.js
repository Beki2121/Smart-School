export async function up(knex) {
  if (!await knex.schema.hasColumn('refresh_tokens', 'campus_id')) {
    await knex.schema.alterTable('refresh_tokens', (table) => {
      table.string('campus_id', 36).nullable()
        .references('id').inTable('campuses').onDelete('SET NULL');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('refresh_tokens', 'campus_id')) {
    await knex.schema.alterTable('refresh_tokens', (table) => table.dropColumn('campus_id'));
  }
}
