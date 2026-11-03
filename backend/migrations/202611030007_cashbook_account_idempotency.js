export async function up(knex) {
  if (!await knex.schema.hasTable('cashbook_accounts') ||
      await knex.schema.hasColumn('cashbook_accounts', 'idempotency_key')) return;

  await knex.schema.alterTable('cashbook_accounts', (table) => {
    table.string('idempotency_key', 100).nullable();
  });
  await knex.raw(
    'UPDATE cashbook_accounts SET idempotency_key = id WHERE idempotency_key IS NULL'
  );
  await knex.schema.alterTable('cashbook_accounts', (table) => {
    table.string('idempotency_key', 100).notNullable().alter();
    table.unique(
      ['organization_id', 'campus_id', 'idempotency_key'],
      'cashbook_account_idem_uq'
    );
  });
}

export async function down(knex) {
  if (!await knex.schema.hasTable('cashbook_accounts') ||
      !await knex.schema.hasColumn('cashbook_accounts', 'idempotency_key')) return;
  await knex.schema.alterTable('cashbook_accounts', (table) => {
    table.dropUnique(
      ['organization_id', 'campus_id', 'idempotency_key'],
      'cashbook_account_idem_uq'
    );
    table.dropColumn('idempotency_key');
  });
}
