export async function up(knex) {
  if (!await knex.schema.hasColumn('fee_items', 'category')) {
    await knex.schema.alterTable('fee_items', (table) => {
      table.string('category', 80).notNullable().defaultTo('core');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('fee_items', 'category')) {
    await knex.schema.alterTable('fee_items', (table) => table.dropColumn('category'));
  }
}
