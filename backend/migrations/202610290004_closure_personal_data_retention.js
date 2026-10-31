export async function up(knex) {
  if (!await knex.schema.hasColumn('organization_closure_requests', 'financial_retention_until')) {
    await knex.schema.alterTable('organization_closure_requests', (table) => {
      table.timestamp('financial_retention_until').nullable();
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('organization_closure_requests', 'financial_retention_until')) {
    await knex.schema.alterTable('organization_closure_requests', (table) => {
      table.dropColumn('financial_retention_until');
    });
  }
}
