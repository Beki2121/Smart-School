async function addOrganizationScope(knex, tableName, campusColumn = 'campus_id') {
  if (!await knex.schema.hasTable(tableName)) return;
  const missingOrganization = !await knex.schema.hasColumn(tableName, 'organization_id');
  const missingCampus = !await knex.schema.hasColumn(tableName, 'campus_id');
  if (!missingOrganization && !missingCampus) return;
  await knex.schema.alterTable(tableName, (table) => {
    if (missingOrganization) table.string('organization_id', 36).nullable();
    if (missingCampus) table.string('campus_id', 36).nullable();
  });
  if (tableName === 'invoice_lines') {
    await knex.raw(
      'UPDATE invoice_lines il JOIN invoices i ON i.id = il.invoice_id ' +
      'SET il.campus_id = i.campus_id, ' +
      'il.organization_id = (SELECT c.organization_id FROM campuses c WHERE c.id = i.campus_id)'
    );
  } else {
    await knex.raw(
      `UPDATE \`${tableName}\` f JOIN campuses c ON c.id = f.\`${campusColumn}\` ` +
      'SET f.campus_id = c.id, f.organization_id = c.organization_id'
    );
  }
  const missing = await knex(tableName).whereNull('organization_id').orWhereNull('campus_id')
    .count({ total: '*' }).first();
  if (Number(missing.total)) {
    throw new Error(`WP5 could not determine organization scope for ${tableName}.`);
  }
  await knex.schema.alterTable(tableName, (table) => {
    table.string('organization_id', 36).notNullable().alter();
    table.string('campus_id', 36).notNullable().alter();
    table.index(['organization_id', 'campus_id'], `${tableName}_org_campus_idx`);
  });
}

async function createTableIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) {
    await knex.schema.createTable(name, (table) => {
      table.collate('utf8mb4_general_ci');
      define(table);
    });
  }
}

export async function up(knex) {
  for (const table of [
    'fee_items', 'invoices', 'invoice_lines', 'fee_payments', 'cashier_shifts', 'fee_expenses'
  ]) {
    await addOrganizationScope(knex, table);
  }

  if (await knex.schema.hasTable('fee_payments') &&
      !await knex.schema.hasColumn('fee_payments', 'idempotency_key')) {
    await knex.schema.alterTable('fee_payments', (table) => {
      table.string('idempotency_key', 100).nullable();
      table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'fee_payment_idempotency_uq');
    });
  }

  await createTableIfMissing(knex, 'fee_structures', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('academic_year_id', 36).notNullable().references('id').inTable('academic_years');
    table.string('grade_level_id', 36).notNullable().references('id').inTable('grade_levels');
    table.string('name', 120).notNullable();
    table.string('currency_code', 3).notNullable();
    table.enu('status', ['draft', 'active', 'archived']).notNullable().defaultTo('draft');
    table.string('created_by', 36).notNullable().references('id').inTable('users');
    table.timestamps(true, true);
    table.index(['organization_id', 'campus_id', 'academic_year_id', 'grade_level_id'],
      'fee_structure_scope_idx');
  });

  await createTableIfMissing(knex, 'fee_structure_installments', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('structure_id', 36).notNullable().references('id').inTable('fee_structures');
    table.integer('installment_number').unsigned().notNullable();
    table.date('due_date').notNullable();
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.unique(['structure_id', 'installment_number'], 'fee_installment_number_uq');
    table.index(['organization_id', 'campus_id', 'due_date'], 'fee_installment_due_idx');
  });

  await createTableIfMissing(knex, 'fee_invoice_generations', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('structure_id', 36).notNullable().references('id').inTable('fee_structures');
    table.string('idempotency_key', 100).notNullable();
    table.string('target_section_id', 36).nullable().references('id').inTable('sections');
    table.integer('invoice_count').unsigned().notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'structure_id', 'idempotency_key'],
      'fee_invoice_generation_idem_uq');
  });

  await createTableIfMissing(knex, 'fee_structure_invoices', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('structure_id', 36).notNullable().references('id').inTable('fee_structures');
    table.string('generation_id', 36).notNullable()
      .references('id').inTable('fee_invoice_generations');
    table.string('installment_id', 36).notNullable().references('id').inTable('fee_structure_installments');
    table.string('student_id', 36).notNullable().references('id').inTable('students');
    table.string('invoice_id', 36).notNullable().references('id').inTable('invoices');
    table.unique(['structure_id', 'installment_id', 'student_id'], 'fee_structure_student_period_uq');
    table.unique(['invoice_id'], 'fee_structure_invoice_uq');
    table.index(['organization_id', 'campus_id', 'student_id'], 'fee_structure_invoice_scope_idx');
  });

  await createTableIfMissing(knex, 'fee_discount_types', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('code', 32).notNullable();
    table.string('name', 120).notNullable();
    table.enu('category', ['sibling', 'staff_child', 'scholarship', 'other']).notNullable();
    table.enu('discount_kind', ['percentage', 'fixed']).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.unique(['organization_id', 'campus_id', 'code'], 'fee_discount_type_code_uq');
  });

  await createTableIfMissing(knex, 'fee_discount_requests', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('student_id', 36).notNullable().references('id').inTable('students');
    table.string('discount_type_id', 36).notNullable().references('id').inTable('fee_discount_types');
    table.string('academic_year_id', 36).nullable().references('id').inTable('academic_years');
    table.string('period_key', 60).notNullable();
    table.integer('percentage_basis_points').unsigned().nullable();
    table.bigInteger('fixed_amount_minor').unsigned().nullable();
    table.string('reason', 500).notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.date('expires_on').nullable();
    table.string('requested_by', 36).notNullable().references('id').inTable('users');
    table.string('approved_by', 36).nullable().references('id').inTable('users');
    table.string('idempotency_key', 100).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'fee_discount_request_idem_uq');
    table.index(['organization_id', 'campus_id', 'status', 'student_id'], 'fee_discount_status_idx');
  });

  await createTableIfMissing(knex, 'fee_discount_applications', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('discount_request_id', 36).notNullable().references('id').inTable('fee_discount_requests');
    table.string('invoice_id', 36).notNullable().references('id').inTable('invoices');
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.unique(['discount_request_id', 'invoice_id'], 'fee_discount_invoice_uq');
    table.index(['organization_id', 'campus_id', 'invoice_id'], 'fee_discount_application_scope_idx');
  });

  await createTableIfMissing(knex, 'fee_refund_requests', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('payment_id', 36).notNullable().references('id').inTable('fee_payments');
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.string('reason', 500).notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.string('requested_by', 36).notNullable().references('id').inTable('users');
    table.string('approved_by', 36).nullable().references('id').inTable('users');
    table.string('idempotency_key', 100).notNullable();
    table.string('refund_payment_id', 36).nullable().references('id').inTable('fee_payments');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'fee_refund_request_idem_uq');
    table.index(['organization_id', 'campus_id', 'payment_id', 'status'], 'fee_refund_payment_status_idx');
  });

  await createTableIfMissing(knex, 'fee_adjustment_requests', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('invoice_id', 36).notNullable().references('id').inTable('invoices');
    table.enu('adjustment_type', ['credit', 'debit']).notNullable();
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.string('reason', 500).notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.string('requested_by', 36).notNullable().references('id').inTable('users');
    table.string('approved_by', 36).nullable().references('id').inTable('users');
    table.string('idempotency_key', 100).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'fee_adjustment_request_idem_uq');
    table.index(['organization_id', 'campus_id', 'invoice_id', 'status'], 'fee_adjustment_invoice_idx');
  });

  await createTableIfMissing(knex, 'fee_adjustments', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('invoice_id', 36).notNullable().references('id').inTable('invoices');
    table.string('request_id', 36).nullable().references('id').inTable('fee_adjustment_requests');
    table.string('discount_application_id', 36).nullable()
      .references('id').inTable('fee_discount_applications');
    table.enu('adjustment_type', ['credit', 'debit']).notNullable();
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.string('reason', 500).notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['request_id'], 'fee_adjustment_request_uq');
    table.unique(['discount_application_id'], 'fee_adjustment_discount_uq');
    table.index(['organization_id', 'campus_id', 'invoice_id'], 'fee_adjustment_scope_idx');
  });

  await createTableIfMissing(knex, 'fee_arrears_followups', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('invoice_id', 36).notNullable().references('id').inTable('invoices');
    table.string('note', 1000).notNullable();
    table.date('next_contact_on').nullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['organization_id', 'campus_id', 'invoice_id', 'next_contact_on'], 'fee_arrears_followup_idx');
  });

  await createTableIfMissing(knex, 'cashbook_accounts', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('name', 120).notNullable();
    table.enu('account_type', ['cash', 'bank']).notNullable();
    table.string('currency_code', 3).notNullable();
    table.bigInteger('opening_balance_minor').unsigned().notNullable().defaultTo(0);
    table.string('idempotency_key', 100).notNullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.string('created_by', 36).notNullable().references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'name'], 'cashbook_account_name_uq');
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'cashbook_account_idem_uq');
    table.index(['organization_id', 'campus_id', 'is_active'], 'cashbook_account_scope_idx');
  });

  await createTableIfMissing(knex, 'cashbook_entries', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('account_id', 36).notNullable().references('id').inTable('cashbook_accounts');
    table.string('entry_type', 24).notNullable();
    table.enu('direction', ['credit', 'debit']).notNullable();
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.string('currency_code', 3).notNullable();
    table.string('description', 500).notNullable();
    table.string('reference', 120).nullable();
    table.string('related_entry_id', 36).nullable().references('id').inTable('cashbook_entries');
    table.string('idempotency_key', 100).notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users');
    table.date('recorded_on').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'], 'cashbook_entry_idem_uq');
    table.index(['organization_id', 'campus_id', 'account_id', 'recorded_on'], 'cashbook_entry_date_idx');
    table.index(['organization_id', 'campus_id', 'account_id', 'related_entry_id'], 'cashbook_entry_related_idx');
  });

  await createTableIfMissing(knex, 'cashbook_reconciliations', (table) => {
    table.string('id', 36).primary();
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('account_id', 36).notNullable().references('id').inTable('cashbook_accounts');
    table.date('statement_date').notNullable();
    table.bigInteger('statement_balance_minor').unsigned().notNullable();
    table.bigInteger('book_balance_minor').notNullable();
    table.bigInteger('difference_minor').notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['account_id', 'statement_date'], 'cashbook_reconciliation_date_uq');
    table.index(['organization_id', 'campus_id', 'statement_date'], 'cashbook_reconciliation_scope_idx');
  });

  await createTableIfMissing(knex, 'cashbook_reconciliation_entries', (table) => {
    table.string('organization_id', 36).notNullable().references('id').inTable('organizations');
    table.string('campus_id', 36).notNullable().references('id').inTable('campuses');
    table.string('reconciliation_id', 36).notNullable().references('id').inTable('cashbook_reconciliations');
    table.string('entry_id', 36).notNullable().references('id').inTable('cashbook_entries');
    table.primary(['reconciliation_id', 'entry_id']);
    table.unique(['entry_id'], 'cashbook_reconciled_entry_uq');
  });
}

export async function down(knex) {
  for (const table of [
    'cashbook_reconciliation_entries', 'cashbook_reconciliations', 'cashbook_entries',
    'cashbook_accounts', 'fee_arrears_followups', 'fee_adjustments',
    'fee_adjustment_requests', 'fee_refund_requests', 'fee_discount_applications',
    'fee_discount_requests', 'fee_discount_types', 'fee_structure_invoices',
    'fee_invoice_generations', 'fee_structure_installments', 'fee_structures'
  ]) await knex.schema.dropTableIfExists(table);
  if (await knex.schema.hasColumn('fee_payments', 'idempotency_key')) {
    await knex.schema.alterTable('fee_payments', (table) => {
      table.dropUnique(['organization_id', 'campus_id', 'idempotency_key'], 'fee_payment_idempotency_uq');
      table.dropColumn('idempotency_key');
    });
  }
  for (const tableName of [
    'fee_items', 'invoices', 'invoice_lines', 'fee_payments', 'cashier_shifts', 'fee_expenses'
  ]) {
    if (!await knex.schema.hasTable(tableName)) continue;
    const hasOrganization = await knex.schema.hasColumn(tableName, 'organization_id');
    const hasCampus = tableName === 'invoice_lines' &&
      await knex.schema.hasColumn(tableName, 'campus_id');
    if (!hasOrganization && !hasCampus) continue;
    await knex.schema.alterTable(tableName, (table) => {
      if (hasOrganization) {
        table.dropIndex(['organization_id', 'campus_id'], `${tableName}_org_campus_idx`);
        table.dropColumn('organization_id');
      }
      if (hasCampus) table.dropColumn('campus_id');
    });
  }
}
