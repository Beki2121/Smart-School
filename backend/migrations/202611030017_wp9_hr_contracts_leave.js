async function createTableIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, define);
}

export async function up(knex) {
  await createTableIfMissing(knex, 'hr_contracts', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('contract_type', 40).notNullable();
    table.date('starts_on').notNullable();
    table.date('ends_on').nullable();
    table.date('renewal_due_on').nullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.text('notes').notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.dateTime('archived_at').nullable().defaultTo(null);
    table.index(['organization_id', 'campus_id', 'staff_id', 'status'], 'wp9_contract_staff_status_idx');
    table.index(['organization_id', 'campus_id', 'ends_on'], 'wp9_contract_expiry_idx');
  });

  await createTableIfMissing(knex, 'hr_contract_renewals', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('contract_id', 36).notNullable().references('id').inTable('hr_contracts').onDelete('RESTRICT');
    table.date('previous_end_date').nullable();
    table.date('new_end_date').notNullable();
    table.string('renewed_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.dateTime('renewed_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'contract_id'], 'wp9_renewal_contract_idx');
  });

  await createTableIfMissing(knex, 'hr_leave_types', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('name', 80).notNullable();
    table.string('kind', 20).notNullable();
    table.integer('annual_entitlement_half_days').unsigned().notNullable().defaultTo(0);
    table.integer('carry_over_limit_half_days').unsigned().notNullable().defaultTo(0);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.unique(['organization_id', 'campus_id', 'name'], 'wp9_leave_type_name_uq');
    table.index(['organization_id', 'campus_id', 'kind', 'is_active'], 'wp9_leave_type_filter_idx');
  });

  await createTableIfMissing(knex, 'hr_leave_balances', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations').onDelete('RESTRICT');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    table.string('leave_type_id', 36).notNullable().references('id').inTable('hr_leave_types').onDelete('RESTRICT');
    table.integer('year').unsigned().notNullable();
    table.integer('entitled_half_days').unsigned().notNullable().defaultTo(0);
    table.integer('carry_over_half_days').unsigned().notNullable().defaultTo(0);
    table.integer('used_half_days').unsigned().notNullable().defaultTo(0);
    table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    table.dateTime('updated_at').nullable().defaultTo(null);
    table.unique(['organization_id', 'campus_id', 'staff_id', 'leave_type_id', 'year'], 'wp9_leave_balance_uq');
    table.index(['organization_id', 'campus_id', 'staff_id', 'year'], 'wp9_leave_balance_staff_idx');
  });

  if (await knex.schema.hasTable('leave_requests')) {
    if (!await knex.schema.hasColumn('leave_requests', 'organization_id')) {
      await knex.schema.alterTable('leave_requests', (table) =>
        table.string('organization_id', 36).nullable());
      await knex('leave_requests').whereNull('organization_id').update({
        organization_id: knex.raw(
          '(SELECT organization_id FROM campuses WHERE campuses.id = leave_requests.campus_id)'
        )
      });
      if (knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql') {
        await knex.schema.alterTable('leave_requests', (table) =>
          table.string('organization_id', 36).notNullable().alter());
        await knex.schema.alterTable('leave_requests', (table) =>
          table.foreign('organization_id', 'wp9_leave_requests_organization_fk')
            .references('id').inTable('organizations').onDelete('RESTRICT'));
      }
    }
    if (knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql') {
      const [indexes] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
        'leave_requests', 'wp9_leave_request_tenant_status_idx'
      ]);
      if (!indexes.length) await knex.schema.alterTable('leave_requests', (table) =>
        table.index(['organization_id', 'campus_id', 'status'], 'wp9_leave_request_tenant_status_idx'));
    }
    if (!await knex.schema.hasColumn('leave_requests', 'leave_type_id')) {
      await knex.schema.alterTable('leave_requests', (table) =>
        table.string('leave_type_id', 36).nullable().references('id').inTable('hr_leave_types').onDelete('RESTRICT'));
    }
    if (!await knex.schema.hasColumn('leave_requests', 'requested_half_days')) {
      await knex.schema.alterTable('leave_requests', (table) =>
        table.integer('requested_half_days').unsigned().notNullable().defaultTo(0));
    }
  }
}

export async function down() {
  throw new Error('WP9 HR migrations are forward-only.');
}
