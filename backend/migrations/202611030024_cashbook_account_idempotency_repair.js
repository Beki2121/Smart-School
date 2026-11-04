export async function up(knex) {
  if (!await knex.schema.hasTable('cashbook_accounts')) return;

  if (!await knex.schema.hasColumn('cashbook_accounts', 'idempotency_key')) {
    await knex.schema.alterTable('cashbook_accounts', (table) => {
      table.string('idempotency_key', 100).nullable();
    });
  }

  await knex.raw(
    'UPDATE cashbook_accounts SET idempotency_key = id WHERE idempotency_key IS NULL'
  );

  const [columns] = await knex.raw(
    `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       AND COLUMN_NAME = 'idempotency_key'`,
    ['cashbook_accounts']
  );
  if (columns[0]?.IS_NULLABLE === 'YES') {
    await knex.schema.alterTable('cashbook_accounts', (table) => {
      table.string('idempotency_key', 100).notNullable().alter();
    });
  }

  const [indexes] = await knex.raw(
    `SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    ['cashbook_accounts']
  );
  const indexGroups = new Map();
  for (const index of indexes) {
    const group = indexGroups.get(index.INDEX_NAME) ?? [];
    group.push(index);
    indexGroups.set(index.INDEX_NAME, group);
  }
  const requiredColumns = ['organization_id', 'campus_id', 'idempotency_key'];
  const matchingIndex = [...indexGroups.values()].some((group) =>
    Number(group[0].NON_UNIQUE) === 0 &&
    group.map((index) => index.COLUMN_NAME).join(',') === requiredColumns.join(','));
  if (matchingIndex) return;

  const namedIndex = indexGroups.get('cashbook_account_idem_uq');
  if (namedIndex) {
    throw new Error('cashbook_account_idem_uq exists with an unexpected definition.');
  }

  await knex.schema.alterTable('cashbook_accounts', (table) => {
    table.unique(requiredColumns, 'cashbook_account_idem_uq');
  });
}

export async function down() {
  throw new Error('Cashbook account idempotency repair is forward-only.');
}
