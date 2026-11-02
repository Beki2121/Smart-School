export async function up(knex) {
  if (!await knex.schema.hasTable('account_invitations') ||
      !await knex.schema.hasColumn('account_invitations', 'campus_id')) {
    throw new Error('Platform invitations require account_invitations.campus_id.');
  }
  await knex.schema.alterTable('account_invitations', (table) => {
    table.string('campus_id', 36).nullable().alter();
  });
}

export async function down(knex) {
  if (!await knex.schema.hasTable('account_invitations')) return;
  const [{ total }] = await knex('account_invitations')
    .whereNull('campus_id').count({ total: '*' });
  if (Number(total) > 0) {
    throw new Error('Cannot require a campus while platform invitations exist.');
  }
  await knex.schema.alterTable('account_invitations', (table) => {
    table.string('campus_id', 36).notNullable().alter();
  });
}
