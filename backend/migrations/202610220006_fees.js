export async function up(knex) {
  if (!await knex.schema.hasTable('fee_items')) {
    await knex.schema.createTable('fee_items', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('code', 32).notNullable();
      table.string('name_en', 120).notNullable();
      table.string('name_am', 120).notNullable();
      table.decimal('amount', 10, 2).unsigned().notNullable();
      table.string('currency_code', 3).notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
      table.unique(['campus_id', 'code'], 'fee_item_code_uq');
      table.index(['campus_id', 'is_active'], 'fee_item_active_idx');
    });
  }
  if (!await knex.schema.hasTable('invoices')) {
    await knex.schema.createTable('invoices', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
      table.string('invoice_number', 32).notNullable();
      table.string('currency_code', 3).notNullable();
      table.decimal('total_amount', 12, 2).unsigned().notNullable();
      table.date('due_date').nullable();
      table.enu('status', ['issued', 'partially_paid', 'paid', 'void']).notNullable().defaultTo('issued');
      table.string('issued_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('issued_at').notNullable().defaultTo(knex.fn.now());
      table.timestamps(true, true);
      table.unique(['campus_id', 'invoice_number'], 'invoice_number_uq');
      table.index(['campus_id', 'student_id', 'status'], 'invoice_student_status_idx');
    });
  }
  if (!await knex.schema.hasTable('invoice_lines')) {
    await knex.schema.createTable('invoice_lines', (table) => {
      table.string('id', 36).primary();
      table.string('invoice_id', 36).notNullable().references('id').inTable('invoices').onDelete('RESTRICT');
      table.string('fee_item_id', 36).nullable().references('id').inTable('fee_items').onDelete('RESTRICT');
      table.string('description_en', 120).notNullable();
      table.string('description_am', 120).notNullable();
      table.decimal('unit_amount', 10, 2).unsigned().notNullable();
      table.integer('quantity').unsigned().notNullable();
      table.decimal('line_total', 12, 2).unsigned().notNullable();
      table.index(['invoice_id'], 'invoice_line_invoice_idx');
    });
  }
  if (!await knex.schema.hasTable('fee_payments')) {
    await knex.schema.createTable('fee_payments', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('invoice_id', 36).notNullable().references('id').inTable('invoices').onDelete('RESTRICT');
      table.string('receipt_number', 32).nullable();
      table.enu('entry_type', ['payment', 'reversal']).notNullable();
      table.string('reverses_payment_id', 36).nullable().references('id').inTable('fee_payments').onDelete('RESTRICT');
      table.decimal('amount', 12, 2).unsigned().notNullable();
      table.string('method', 24).notNullable();
      table.string('reference', 120).nullable();
      table.string('reason', 500).nullable();
      table.string('recorded_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['campus_id', 'receipt_number'], 'fee_receipt_number_uq');
      table.index(['invoice_id', 'recorded_at'], 'fee_payment_invoice_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('fee_payments');
  await knex.schema.dropTableIfExists('invoice_lines');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('fee_items');
}
