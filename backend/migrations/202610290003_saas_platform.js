import { randomUUID } from 'node:crypto';

const platformOrganizationId = '00000000-0000-4000-8000-000000000001';

export async function up(knex) {
  const organizationColumns = [
    ['status', (table) => table.string('status', 24).notNullable().defaultTo('pending')],
    ['preferred_locale', (table) => table.string('preferred_locale', 8).notNullable().defaultTo('en')],
    ['currency_code', (table) => table.string('currency_code', 3).notNullable().defaultTo('ETB')],
    ['branding_json', (table) => table.text('branding_json').nullable()],
    ['requested_at', (table) => table.timestamp('requested_at').nullable()],
    ['activated_at', (table) => table.timestamp('activated_at').nullable()],
    ['suspended_at', (table) => table.timestamp('suspended_at').nullable()],
    ['closed_at', (table) => table.timestamp('closed_at').nullable()],
    ['closure_retention_until', (table) => table.timestamp('closure_retention_until').nullable()]
  ];
  for (const [column, add] of organizationColumns) {
    if (!await knex.schema.hasColumn('organizations', column)) {
      await knex.schema.alterTable('organizations', add);
    }
  }
  const platformOrganization = await knex('organizations')
    .where({ id: platformOrganizationId }).first('id');
  if (!platformOrganization) {
    await knex('organizations').insert({
      id: platformOrganizationId, name: 'SIMS Platform Administration',
      status: 'platform', preferred_locale: 'en', currency_code: 'ETB',
      branding_json: JSON.stringify({}), requested_at: knex.fn.now()
    });
  }

  if (!await knex.schema.hasTable('subscription_plans')) {
    await knex.schema.createTable('subscription_plans', (table) => {
      table.string('id', 36).primary();
      table.string('code', 40).notNullable().unique();
      table.string('name', 100).notNullable();
      table.string('description', 1000).notNullable().defaultTo('');
      table.decimal('monthly_price', 12, 2).unsigned().notNullable().defaultTo(0);
      table.string('currency_code', 3).notNullable().defaultTo('ETB');
      table.integer('trial_days').unsigned().notNullable().defaultTo(30);
      table.integer('student_limit').unsigned().nullable();
      table.integer('staff_limit').unsigned().nullable();
      table.integer('site_limit').unsigned().nullable();
      table.text('modules_json').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamps(true, true);
    });
  }
  if (!await knex.schema.hasTable('organization_subscriptions')) {
    await knex.schema.createTable('organization_subscriptions', (table) => {
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('plan_id', 36).notNullable()
        .references('id').inTable('subscription_plans').onDelete('RESTRICT');
      table.string('status', 24).notNullable();
      table.timestamp('trial_started_at').nullable();
      table.timestamp('trial_ends_at').nullable();
      table.timestamp('period_started_at').nullable();
      table.timestamp('period_ends_at').nullable();
      table.timestamp('canceled_at').nullable();
      table.string('created_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
      table.index(['organization_id', 'status'], 'org_subscription_status_idx');
    });
  }
  if (!await knex.schema.hasTable('subscription_invoices')) {
    await knex.schema.createTable('subscription_invoices', (table) => {
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('subscription_id', 36).nullable()
        .references('id').inTable('organization_subscriptions').onDelete('SET NULL');
      table.string('invoice_number', 40).notNullable().unique();
      table.decimal('amount', 12, 2).unsigned().notNullable();
      table.string('currency_code', 3).notNullable();
      table.string('status', 24).notNullable().defaultTo('issued');
      table.date('due_on').nullable();
      table.timestamp('issued_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('paid_at').nullable();
      table.string('issued_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
      table.index(['organization_id', 'status'], 'sub_invoice_org_status_idx');
    });
  }
  if (!await knex.schema.hasTable('subscription_payments')) {
    await knex.schema.createTable('subscription_payments', (table) => {
      table.string('id', 36).primary();
      table.string('invoice_id', 36).notNullable()
        .references('id').inTable('subscription_invoices').onDelete('RESTRICT');
      table.decimal('amount', 12, 2).unsigned().notNullable();
      table.string('reference', 120).nullable();
      table.string('note', 500).nullable();
      table.date('received_on').notNullable();
      table.string('recorded_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
      table.timestamps(true, true);
      table.index(['invoice_id', 'received_on'], 'sub_payment_invoice_date_idx');
    });
  }
  if (!await knex.schema.hasTable('organization_closure_requests')) {
    await knex.schema.createTable('organization_closure_requests', (table) => {
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('status', 24).notNullable().defaultTo('requested');
      table.string('reason', 1000).notNullable();
      table.string('requested_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('exported_at').nullable();
      table.timestamp('approved_at').nullable();
      table.timestamp('retention_until').nullable();
      table.timestamp('completed_at').nullable();
      table.string('reviewed_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
      table.index(['organization_id', 'status'], 'org_closure_status_idx');
    });
  }

  const starterExists = await knex('subscription_plans').where({ code: 'starter' }).first('id');
  if (!starterExists) {
    await knex('subscription_plans').insert({
      id: randomUUID(), code: 'starter', name: 'Starter',
      description: 'Initial private-school trial plan', monthly_price: 0,
      currency_code: 'ETB', trial_days: 30, student_limit: 100,
      staff_limit: 20, site_limit: 1,
      modules_json: JSON.stringify([
        'academic_setup', 'student_information', 'admissions', 'attendance',
        'marks', 'fees', 'staff', 'timetable', 'communications'
      ]),
      is_active: true
    });
  }

  const legacyExists = await knex('subscription_plans').where({ code: 'legacy' }).first('id');
  if (!legacyExists) {
    await knex('subscription_plans').insert({
      id: randomUUID(), code: 'legacy', name: 'Existing School',
      description: 'Unmetered plan for schools already in the system',
      monthly_price: 0, currency_code: 'ETB', trial_days: 0,
      student_limit: null, staff_limit: null, site_limit: null,
      modules_json: JSON.stringify([]), is_active: false
    });
  }

  await knex('organizations').whereNull('requested_at').update({
    status: 'active', activated_at: knex.fn.now()
  });
  const legacyPlan = await knex('subscription_plans').where({ code: 'legacy' }).first('id');
  const organizations = await knex('organizations').whereNot({ status: 'platform' }).select('id');
  for (const organization of organizations) {
    const subscription = await knex('organization_subscriptions')
      .where({ organization_id: organization.id }).first('id');
    if (!subscription) {
      await knex('organization_subscriptions').insert({
        id: randomUUID(), organization_id: organization.id,
        plan_id: legacyPlan.id, status: 'active'
      });
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('organization_closure_requests');
  await knex.schema.dropTableIfExists('subscription_payments');
  await knex.schema.dropTableIfExists('subscription_invoices');
  await knex.schema.dropTableIfExists('organization_subscriptions');
  await knex.schema.dropTableIfExists('subscription_plans');
  const columns = [
    'closure_retention_until', 'closed_at', 'suspended_at', 'activated_at',
    'requested_at', 'branding_json', 'currency_code', 'preferred_locale'
  ];
  for (const column of columns) {
    if (await knex.schema.hasColumn('organizations', column)) {
      await knex.schema.alterTable('organizations', (table) => table.dropColumn(column));
    }
  }
}
