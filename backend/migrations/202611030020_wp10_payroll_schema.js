async function createIfMissing(knex, name, define) {
  if (!await knex.schema.hasTable(name)) await knex.schema.createTable(name, define);
}

function tenantColumns(table) {
  table.string('organization_id', 36).notNullable()
    .references('id').inTable('organizations').onDelete('RESTRICT');
  table.string('campus_id', 36).notNullable()
    .references('id').inTable('campuses').onDelete('RESTRICT');
}

function timestamps(table, knex) {
  table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
}

export async function up(knex) {
  await createIfMissing(knex, 'payroll_salary_rules', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('code', 80).notNullable();
    table.string('idempotency_key', 100).notNullable();
    table.string('name', 160).notNullable();
    table.string('kind', 20).notNullable();
    table.text('configuration_json').notNullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.string('created_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'code'], 'payroll_salary_rules_code_uq');
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'payroll_salary_rules_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'kind', 'status'],
      'payroll_salary_rules_tenant_status_idx');
  });

  await createIfMissing(knex, 'payroll_salary_structures', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('staff_id', 36).notNullable().references('id').inTable('staff')
      .onDelete('RESTRICT');
    table.string('currency_code', 3).notNullable();
    table.string('idempotency_key', 100).notNullable();
    table.bigInteger('basic_salary_minor').unsigned().notNullable();
    table.text('allowances_json').notNullable();
    table.text('deductions_json').notNullable();
    table.string('tax_rule_id', 36).nullable().references('id').inTable('payroll_salary_rules')
      .onDelete('RESTRICT');
    table.string('pension_rule_id', 36).nullable().references('id').inTable('payroll_salary_rules')
      .onDelete('RESTRICT');
    table.bigInteger('overtime_rate_minor_per_hour').unsigned().notNullable().defaultTo(0);
    table.date('effective_from').notNullable();
    table.date('effective_to').nullable();
    table.string('status', 20).notNullable().defaultTo('active');
    table.string('created_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.string('updated_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'staff_id', 'effective_from'],
      'payroll_salary_structure_effective_uq');
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'payroll_salary_structure_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'staff_id', 'status'],
      'payroll_salary_structure_staff_idx');
    table.index(['organization_id', 'campus_id', 'effective_from', 'effective_to'],
      'payroll_salary_structure_dates_idx');
  });

  await createIfMissing(knex, 'payroll_periods', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('code', 32).notNullable();
    table.string('idempotency_key', 100).notNullable();
    table.string('currency_code', 3).notNullable();
    table.date('starts_on').notNullable();
    table.date('ends_on').notNullable();
    table.string('status', 20).notNullable().defaultTo('draft');
    table.string('created_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.timestamp('opened_at').nullable();
    table.timestamp('closed_at').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'code'], 'payroll_period_code_uq');
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'payroll_period_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'starts_on', 'status'],
      'payroll_period_tenant_status_idx');
  });

  await createIfMissing(knex, 'payroll_runs', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('period_id', 36).notNullable().references('id').inTable('payroll_periods')
      .onDelete('RESTRICT');
    table.string('active_period_id', 36).nullable();
    table.string('idempotency_key', 100).notNullable();
    table.string('status', 24).notNullable().defaultTo('draft');
    table.string('prepared_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.string('reviewed_by', 36).nullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.text('input_fingerprint').nullable();
    table.timestamp('calculated_at').nullable();
    table.timestamp('submitted_at').nullable();
    table.timestamp('approved_at').nullable();
    table.timestamp('rejected_at').nullable();
    table.timestamp('locked_at').nullable();
    table.timestamp('closed_at').nullable();
    table.text('rejection_reason').nullable();
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'payroll_run_idempotency_uq');
    table.unique(['organization_id', 'campus_id', 'active_period_id'],
      'payroll_run_active_period_uq');
    table.index(['organization_id', 'campus_id', 'period_id', 'status'],
      'payroll_run_period_status_idx');
  });

  await createIfMissing(knex, 'payroll_inputs', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('period_id', 36).notNullable().references('id').inTable('payroll_periods')
      .onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff')
      .onDelete('RESTRICT');
    table.integer('attendance_days').unsigned().notNullable().defaultTo(0);
    table.integer('overtime_minutes').unsigned().notNullable().defaultTo(0);
    table.bigInteger('bonus_minor').unsigned().notNullable().defaultTo(0);
    table.bigInteger('adjustment_minor').notNullable().defaultTo(0);
    table.string('adjustment_reason', 500).notNullable().defaultTo('');
    table.integer('source_attendance_days').unsigned().notNullable().defaultTo(0);
    table.integer('source_unpaid_leave_half_days').unsigned().notNullable().defaultTo(0);
    table.boolean('loaded_from_hr').notNullable().defaultTo(false);
    table.string('updated_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    timestamps(table, knex);
    table.unique(['organization_id', 'campus_id', 'period_id', 'staff_id'],
      'payroll_input_staff_period_uq');
    table.index(['organization_id', 'campus_id', 'period_id', 'staff_id'],
      'payroll_input_period_staff_idx');
  });

  await createIfMissing(knex, 'payroll_lines', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('run_id', 36).notNullable().references('id').inTable('payroll_runs')
      .onDelete('RESTRICT');
    table.string('period_id', 36).notNullable().references('id').inTable('payroll_periods')
      .onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff')
      .onDelete('RESTRICT');
    table.string('salary_structure_id', 36).notNullable()
      .references('id').inTable('payroll_salary_structures').onDelete('RESTRICT');
    table.string('currency_code', 3).notNullable();
    table.bigInteger('base_salary_minor').unsigned().notNullable();
    table.bigInteger('prorated_base_minor').notNullable();
    table.bigInteger('allowances_minor').notNullable();
    table.bigInteger('overtime_minor').notNullable();
    table.bigInteger('bonus_minor').notNullable();
    table.bigInteger('adjustment_minor').notNullable();
    table.bigInteger('unpaid_leave_deduction_minor').notNullable();
    table.bigInteger('tax_minor').notNullable();
    table.bigInteger('pension_minor').notNullable();
    table.bigInteger('other_deductions_minor').notNullable();
    table.bigInteger('gross_minor').notNullable();
    table.bigInteger('net_minor').notNullable();
    table.text('calculation_details_json').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'run_id', 'staff_id'],
      'payroll_line_run_staff_uq');
    table.index(['organization_id', 'campus_id', 'period_id', 'staff_id'],
      'payroll_line_period_staff_idx');
    table.index(['organization_id', 'campus_id', 'run_id', 'staff_id'],
      'payroll_line_run_staff_idx');
  });

  await createIfMissing(knex, 'payroll_adjustments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('period_id', 36).notNullable().references('id').inTable('payroll_periods')
      .onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff')
      .onDelete('RESTRICT');
    table.string('source_line_id', 36).nullable().references('id').inTable('payroll_lines')
      .onDelete('RESTRICT');
    table.string('idempotency_key', 100).notNullable();
    table.bigInteger('amount_minor').notNullable();
    table.string('reason', 500).notNullable();
    table.string('created_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'payroll_adjustment_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'period_id', 'staff_id'],
      'payroll_adjustment_period_staff_idx');
  });

  await createIfMissing(knex, 'payroll_payments', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('run_id', 36).notNullable().references('id').inTable('payroll_runs')
      .onDelete('RESTRICT');
    table.string('period_id', 36).notNullable().references('id').inTable('payroll_periods')
      .onDelete('RESTRICT');
    table.string('line_id', 36).notNullable().references('id').inTable('payroll_lines')
      .onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff')
      .onDelete('RESTRICT');
    table.string('idempotency_key', 100).notNullable();
    table.string('reference', 120).notNullable();
    table.bigInteger('amount_minor').unsigned().notNullable();
    table.string('currency_code', 3).notNullable();
    table.date('payment_date').notNullable();
    table.timestamp('paid_at').nullable();
    table.string('recorded_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'idempotency_key'],
      'payroll_payment_idempotency_uq');
    table.index(['organization_id', 'campus_id', 'period_id', 'payment_date'],
      'payroll_payment_period_date_idx');
    table.index(['organization_id', 'campus_id', 'line_id'],
      'payroll_payment_line_idx');
  });

  await createIfMissing(knex, 'payroll_payslips', (table) => {
    table.collate('utf8mb4_general_ci');
    table.string('id', 36).primary();
    tenantColumns(table);
    table.string('run_id', 36).notNullable().references('id').inTable('payroll_runs')
      .onDelete('RESTRICT');
    table.string('period_id', 36).notNullable().references('id').inTable('payroll_periods')
      .onDelete('RESTRICT');
    table.string('line_id', 36).notNullable().references('id').inTable('payroll_lines')
      .onDelete('RESTRICT');
    table.string('staff_id', 36).notNullable().references('id').inTable('staff')
      .onDelete('RESTRICT');
    table.text('snapshot_json').notNullable();
    table.string('generated_by', 36).notNullable().references('id').inTable('users')
      .onDelete('RESTRICT');
    table.timestamp('generated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['organization_id', 'campus_id', 'line_id'], 'payroll_payslip_line_uq');
    table.index(['organization_id', 'campus_id', 'period_id', 'staff_id'],
      'payroll_payslip_period_staff_idx');
  });
}

export async function down() {
  throw new Error('WP10 payroll schema migration is forward-only.');
}
