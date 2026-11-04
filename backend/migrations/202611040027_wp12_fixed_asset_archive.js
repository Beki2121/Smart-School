export async function up(knex) {
  if (!await knex.schema.hasColumn('fixed_assets', 'archived_at')) {
    await knex.schema.alterTable('fixed_assets', (table) => {
      table.timestamp('archived_at').nullable();
    });
  }
  const [indexes] = await knex.raw(
    'SHOW INDEX FROM `fixed_assets` WHERE Key_name = ?',
    ['fixed_asset_archive_status_idx']
  );
  if (!indexes.length) {
    await knex.schema.alterTable('fixed_assets', (table) => {
      table.index(['organization_id', 'campus_id', 'archived_at', 'status'],
        'fixed_asset_archive_status_idx');
    });
  }
}

export async function down() {
  throw new Error('WP12 fixed-asset archive migration is forward-only.');
}
