export async function up(knex) {
  if (!await knex.schema.hasColumn('invoice_lines', 'description_am')) {
    await knex.schema.alterTable('invoice_lines', (table) => {
      table.string('description_am', 120).notNullable().defaultTo('');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('invoice_lines', 'description_am')) {
    await knex.schema.alterTable('invoice_lines', (table) => table.dropColumn('description_am'));
  }
}
