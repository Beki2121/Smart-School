export async function up(knex) {
  if (!await knex.schema.hasColumn('users', 'username')) {
    await knex.schema.alterTable('users', (table) => {
      table.string('username', 80).nullable().unique();
    });
  }
  if (!await knex.schema.hasColumn('users', 'must_change_password')) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('must_change_password').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'must_change_password')) {
    await knex.schema.alterTable('users', (table) => table.dropColumn('must_change_password'));
  }
  if (await knex.schema.hasColumn('users', 'username')) {
    await knex.schema.alterTable('users', (table) => table.dropColumn('username'));
  }
}
