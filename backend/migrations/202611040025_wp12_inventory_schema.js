function tenant(table) {
  table.string('organization_id', 36).notNullable()
    .references('id').inTable('organizations').onDelete('RESTRICT');
  table.string('campus_id', 36).notNullable()
    .references('id').inTable('campuses').onDelete('RESTRICT');
}

function timestamps(table, knex) {
  table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
}

async function createIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, define);
}

export async function up(knex) {
  await createIfMissing(knex, 'inventory_categories', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('name', 120).notNullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'name'], 'inventory_category_name_uq');
    table.index(['organization_id', 'campus_id', 'status'], 'inventory_category_status_idx');
  });
  await createIfMissing(knex, 'inventory_suppliers', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('name', 180).notNullable();
    table.string('contact_name', 180).notNullable().defaultTo('');
    table.string('email', 254).notNullable().defaultTo('');
    table.string('phone', 40).notNullable().defaultTo('');
    table.text('address').notNullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'name'], 'inventory_supplier_name_idx');
    table.index(['organization_id', 'campus_id', 'status'], 'inventory_supplier_status_idx');
  });
  await createIfMissing(knex, 'inventory_items', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('category_id', 36).notNullable().references('id')
      .inTable('inventory_categories').onDelete('RESTRICT');
    table.string('sku', 80).notNullable();
    table.string('name', 180).notNullable();
    table.string('unit', 32).notNullable();
    table.integer('reorder_level').unsigned().notNullable().defaultTo(0);
    table.integer('current_quantity').unsigned().notNullable().defaultTo(0);
    table.bigInteger('average_unit_cost_minor').unsigned().notNullable().defaultTo(0);
    table.string('currency_code', 3).notNullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.timestamp('archived_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'sku'], 'inventory_item_sku_uq');
    table.index(['organization_id', 'campus_id', 'category_id', 'status'], 'inventory_item_category_idx');
    table.index(['organization_id', 'campus_id', 'current_quantity'], 'inventory_item_quantity_idx');
  });
  await createIfMissing(knex, 'inventory_purchases', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('purchase_number', 80).notNullable();
    table.string('supplier_id', 36).notNullable().references('id')
      .inTable('inventory_suppliers').onDelete('RESTRICT');
    table.date('purchased_on').notNullable();
    table.date('expected_on').nullable();
    table.string('currency_code', 3).notNullable();
    table.string('status', 24).notNullable().defaultTo('draft');
    table.text('notes').notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'purchase_number'], 'inventory_purchase_number_uq');
    table.index(['organization_id', 'campus_id', 'supplier_id', 'status'], 'inventory_purchase_supplier_status_idx');
    table.index(['organization_id', 'campus_id', 'purchased_on'], 'inventory_purchase_date_idx');
  });
  await createIfMissing(knex, 'inventory_purchase_lines', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('purchase_id', 36).notNullable().references('id')
      .inTable('inventory_purchases').onDelete('RESTRICT');
    table.string('item_id', 36).notNullable().references('id')
      .inTable('inventory_items').onDelete('RESTRICT');
    table.integer('quantity').unsigned().notNullable();
    table.integer('received_quantity').unsigned().notNullable().defaultTo(0);
    table.bigInteger('unit_cost_minor').unsigned().notNullable();
    timestamps(table, knex);
    table.index(['organization_id', 'campus_id', 'purchase_id'], 'inventory_line_purchase_idx');
    table.index(['organization_id', 'campus_id', 'item_id'], 'inventory_line_item_idx');
  });
  await createIfMissing(knex, 'inventory_receipts', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('purchase_id', 36).notNullable().references('id')
      .inTable('inventory_purchases').onDelete('RESTRICT');
    table.string('idempotency_key', 100).notNullable();
    table.date('received_on').notNullable();
    table.string('received_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'inventory_receipt_idem_uq');
    table.index(['organization_id', 'campus_id', 'purchase_id'], 'inventory_receipt_purchase_idx');
  });
  await createIfMissing(knex, 'inventory_receipt_lines', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('receipt_id', 36).notNullable().references('id')
      .inTable('inventory_receipts').onDelete('RESTRICT');
    table.string('purchase_line_id', 36).notNullable().references('id')
      .inTable('inventory_purchase_lines').onDelete('RESTRICT');
    table.integer('quantity').unsigned().notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'purchase_line_id'], 'inventory_receipt_line_line_idx');
  });
  await createIfMissing(knex, 'inventory_movements', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('item_id', 36).notNullable().references('id')
      .inTable('inventory_items').onDelete('RESTRICT');
    table.string('movement_type', 20).notNullable();
    table.integer('quantity_delta').notNullable();
    table.integer('quantity_after').unsigned().notNullable();
    table.bigInteger('unit_cost_minor').unsigned().notNullable();
    table.bigInteger('total_cost_minor').unsigned().notNullable();
    table.string('currency_code', 3).notNullable();
    table.string('purchase_id', 36).nullable().references('id')
      .inTable('inventory_purchases').onDelete('RESTRICT');
    table.string('receipt_id', 36).nullable().references('id')
      .inTable('inventory_receipts').onDelete('RESTRICT');
    table.string('idempotency_key', 100).nullable();
    table.date('moved_on').notNullable();
    table.string('reason', 500).notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'inventory_movement_idem_uq');
    table.index(['organization_id', 'campus_id', 'item_id', 'moved_on'], 'inventory_movement_item_date_idx');
    table.index(['organization_id', 'campus_id', 'purchase_id'], 'inventory_movement_purchase_idx');
  });
  await createIfMissing(knex, 'fixed_assets', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('asset_tag', 80).notNullable();
    table.string('category', 120).notNullable();
    table.string('name', 180).notNullable();
    table.date('purchased_on').notNullable();
    table.bigInteger('purchase_cost_minor').unsigned().notNullable();
    table.string('currency_code', 3).notNullable();
    table.string('condition', 32).notNullable().defaultTo('good');
    table.string('location', 180).notNullable().defaultTo('');
    table.string('status', 24).notNullable().defaultTo('available');
    table.string('active_allocation_id', 36).nullable();
    table.text('notes').notNullable();
    table.timestamp('disposed_at').nullable();
    table.timestamp('lost_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'asset_tag'], 'fixed_asset_tag_uq');
    table.unique(['organization_id', 'campus_id', 'active_allocation_id'], 'asset_active_allocation_uq');
    table.index(['organization_id', 'campus_id', 'category', 'status'], 'fixed_asset_category_status_idx');
    table.index(['organization_id', 'campus_id', 'status'], 'fixed_asset_status_idx');
  });
  await createIfMissing(knex, 'asset_allocations', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('asset_id', 36).notNullable().references('id')
      .inTable('fixed_assets').onDelete('RESTRICT');
    table.string('active_asset_id', 36).nullable();
    table.string('staff_id', 36).nullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('room_id', 36).nullable().references('id').inTable('rooms').onDelete('RESTRICT');
    table.date('allocated_on').notNullable();
    table.date('returned_on').nullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.string('allocated_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.string('returned_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    table.text('notes').notNullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'active_asset_id'], 'asset_allocation_active_uq');
    table.index(['organization_id', 'campus_id', 'asset_id', 'status'], 'asset_allocation_asset_idx');
    table.index(['organization_id', 'campus_id', 'staff_id', 'status'], 'asset_allocation_staff_idx');
  });
  await createIfMissing(knex, 'asset_maintenance', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenant(table);
    table.string('asset_id', 36).notNullable().references('id')
      .inTable('fixed_assets').onDelete('RESTRICT');
    table.date('maintenance_on').notNullable();
    table.string('note', 2000).notNullable();
    table.bigInteger('cost_minor').unsigned().notNullable().defaultTo(0);
    table.string('currency_code', 3).notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'asset_id', 'maintenance_on'], 'asset_maintenance_asset_date_idx');
  });
}

export async function down() {
  throw new Error('WP12 inventory schema migration is forward-only.');
}
