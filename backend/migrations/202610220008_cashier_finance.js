export async function up(knex) {
  if (!await knex.schema.hasTable('cashier_shifts')) {
    await knex.schema.createTable('cashier_shifts', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('opened_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('closed_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
      table.string('currency_code', 3).notNullable();
      table.decimal('opening_float', 12, 2).unsigned().notNullable();
      table.decimal('closing_cash', 12, 2).unsigned().nullable();
      table.decimal('expected_cash', 12, 2).nullable();
      table.decimal('variance', 12, 2).nullable();
      table.enu('status', ['open', 'closed']).notNullable().defaultTo('open');
      table.date('recorded_on').notNullable();
      table.timestamp('opened_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('closed_at').nullable();
      table.timestamps(true, true);
      table.index(['campus_id', 'opened_by', 'status'], 'cashier_shift_open_idx');
      table.index(['campus_id', 'recorded_on'], 'cashier_shift_date_idx');
    });
  }
  if (!await knex.schema.hasTable('fee_expenses')) {
    await knex.schema.createTable('fee_expenses', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('cashier_shift_id', 36).notNullable().references('id').inTable('cashier_shifts').onDelete('RESTRICT');
      table.string('category', 80).notNullable();
      table.string('description', 500).notNullable();
      table.decimal('amount', 12, 2).unsigned().notNullable();
      table.string('currency_code', 3).notNullable();
      table.enu('method', ['cash', 'bank_transfer', 'mobile_money', 'other']).notNullable();
      table.string('reference', 120).nullable();
      table.string('recorded_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.date('recorded_on').notNullable();
      table.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
      table.timestamps(true, true);
      table.index(['campus_id', 'recorded_on'], 'fee_expense_date_idx');
      table.index(['cashier_shift_id', 'method'], 'fee_expense_shift_idx');
    });
  }
  if (!await knex.schema.hasColumn('fee_payments', 'cashier_shift_id')) {
    await knex.schema.alterTable('fee_payments', (table) => {
      table.string('cashier_shift_id', 36).nullable()
        .references('id').inTable('cashier_shifts').onDelete('RESTRICT');
    });
  }
  if (!await knex.schema.hasColumn('fee_payments', 'recorded_on')) {
    await knex.schema.alterTable('fee_payments', (table) => {
      table.date('recorded_on').nullable();
    });
    await knex('fee_payments').whereNull('recorded_on')
      .update({ recorded_on: knex.raw('DATE(recorded_at)') });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('fee_payments', 'recorded_on')) {
    await knex.schema.alterTable('fee_payments', (table) => table.dropColumn('recorded_on'));
  }
  if (await knex.schema.hasColumn('fee_payments', 'cashier_shift_id')) {
    await knex.schema.alterTable('fee_payments', (table) => table.dropColumn('cashier_shift_id'));
  }
  await knex.schema.dropTableIfExists('fee_expenses');
  await knex.schema.dropTableIfExists('cashier_shifts');
}
