export async function up(knex) {
  if (!await knex.schema.hasTable('account_invitations')) {
    throw new Error('Cannot add platform school invitations before account_invitations exists.');
  }
  if (!await knex.schema.hasColumn('account_invitations', 'target_name')) {
    await knex.schema.alterTable('account_invitations', (table) => {
      table.string('target_name', 180).nullable();
    });
  }
  const [columns] = await knex.raw(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS max_length
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'account_invitations'
       AND COLUMN_NAME = 'target_type'`
  );
  if (Number(columns[0]?.max_length ?? 0) < 32) {
    await knex.schema.alterTable('account_invitations', (table) => {
      table.string('target_type', 32).notNullable().alter();
    });
  }
}

export async function down(knex) {
  if (!await knex.schema.hasTable('account_invitations')) return;
  if (await knex.schema.hasColumn('account_invitations', 'target_type')) {
    const [{ total }] = await knex('account_invitations')
      .whereRaw('CHAR_LENGTH(`target_type`) > 16').count({ total: '*' });
    if (Number(total) > 0) {
      throw new Error('Cannot shrink account_invitations.target_type while values exceed 16 characters.');
    }
  }
  if (await knex.schema.hasColumn('account_invitations', 'target_name')) {
    await knex.schema.alterTable('account_invitations', (table) => table.dropColumn('target_name'));
  }
  if (await knex.schema.hasColumn('account_invitations', 'target_type')) {
    await knex.schema.alterTable('account_invitations', (table) => {
      table.string('target_type', 16).notNullable().alter();
    });
  }
}
