async function addColumn(knex, tableName, column, define) {
  if (!await knex.schema.hasColumn(tableName, column)) {
    await knex.schema.alterTable(tableName, define);
  }
}

async function hasIndex(knex, tableName, name) {
  const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [tableName, name]);
  return rows.length > 0;
}

async function hasForeignKey(knex, tableName, columnName, referencedTable) {
  const [rows] = await knex.raw(
    `SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
        AND REFERENCED_TABLE_NAME = ? LIMIT 1`,
    [tableName, columnName, referencedTable]
  );
  return rows.length > 0;
}

async function addForeignKey(knex, tableName, columnName, referencedTable) {
  if (await hasForeignKey(knex, tableName, columnName, referencedTable)) return;
  await knex.schema.alterTable(tableName, (table) => {
    table.foreign(columnName, `wp9_${tableName}_${columnName}_fk`)
      .references('id').inTable(referencedTable).onDelete('RESTRICT');
  });
}

export async function up(knex) {
  await addColumn(knex, 'staff', 'organization_id', (table) =>
    table.string('organization_id', 36).nullable());
  await knex('staff').whereNull('organization_id').update({
    organization_id: knex.raw(
      '(SELECT organization_id FROM campuses WHERE campuses.id = staff.campus_id)'
    )
  });
  if (knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql') {
    await knex.schema.alterTable('staff', (table) =>
      table.string('organization_id', 36).notNullable().alter());
    await addForeignKey(knex, 'staff', 'organization_id', 'organizations');
  }
  if (!await hasIndex(knex, 'staff', 'wp9_staff_tenant_status_idx')) {
    await knex.schema.alterTable('staff', (table) =>
      table.index(['organization_id', 'campus_id', 'employment_status'], 'wp9_staff_tenant_status_idx'));
  }
  if (!await hasIndex(knex, 'staff', 'wp9_staff_tenant_department_idx')) {
    await knex.schema.alterTable('staff', (table) =>
      table.index(['organization_id', 'campus_id', 'department_id'], 'wp9_staff_tenant_department_idx'));
  }

  if (!await knex.schema.hasTable('staff_documents')) await knex.schema.createTable('staff_documents', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('category', 40).notNullable();
    table.string('original_name', 180).notNullable();
    table.string('mime_type', 80).notNullable();
    table.integer('size_bytes').unsigned().notNullable();
    table.string('storage_key', 36).notNullable().unique();
    table.string('sha256', 64).notNullable();
    table.string('uploaded_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'staff_id'], 'wp9_staff_docs_owner_idx');
    table.index(['organization_id', 'campus_id', 'category'], 'wp9_staff_docs_category_idx');
  });
}

export async function down() {
  throw new Error('WP9 HR migrations are forward-only.');
}
