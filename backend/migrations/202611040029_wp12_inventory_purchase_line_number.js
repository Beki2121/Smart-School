export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('inventory_purchase_lines', 'line_number');
  if (!hasColumn) {
    await knex.schema.alterTable('inventory_purchase_lines', (table) => {
      table.integer('line_number').unsigned().nullable();
    });
  }

  const rows = await knex('inventory_purchase_lines')
    .select('id', 'purchase_id', 'line_number')
    .orderBy('purchase_id')
    .orderBy('created_at')
    .orderBy('id');
  if (rows.some((row) => row.line_number === null || row.line_number === undefined)) {
    let purchaseId = null;
    let lineNumber = 0;
    for (const row of rows) {
      if (row.purchase_id !== purchaseId) {
        purchaseId = row.purchase_id;
        lineNumber = 0;
      }
      await knex('inventory_purchase_lines').where({ id: row.id })
        .update({ line_number: ++lineNumber });
    }
  }

  const [columns] = await knex.raw(
    'SHOW COLUMNS FROM `inventory_purchase_lines` LIKE ?',
    ['line_number']
  );
  if (columns[0].Null === 'YES') {
    await knex.schema.alterTable('inventory_purchase_lines', (table) => {
      table.integer('line_number').unsigned().notNullable().alter();
    });
  }

  const [indexes] = await knex.raw(
    'SHOW INDEX FROM `inventory_purchase_lines` WHERE Key_name = ?',
    ['inventory_purchase_line_order_uq']
  );
  if (!indexes.length) {
    await knex.schema.alterTable('inventory_purchase_lines', (table) => {
      table.unique(
        ['organization_id', 'campus_id', 'purchase_id', 'line_number'],
        'inventory_purchase_line_order_uq'
      );
    });
  }
}

export async function down() {
  throw new Error('WP12 purchase line ordering migration is forward-only.');
}
