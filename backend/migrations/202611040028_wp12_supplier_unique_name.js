export async function up(knex) {
  const [indexes] = await knex.raw(
    'SHOW INDEX FROM `inventory_suppliers` WHERE Key_name = ?',
    ['inventory_supplier_name_uq']
  );
  if (!indexes.length) {
    await knex.schema.alterTable('inventory_suppliers', (table) => {
      table.unique(['organization_id', 'campus_id', 'name'],
        'inventory_supplier_name_uq');
    });
  }
}

export async function down() {
  throw new Error('WP12 supplier uniqueness migration is forward-only.');
}
