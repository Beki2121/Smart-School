import { randomUUID } from 'node:crypto';

async function addColumn(knex, tableName, columnName, add) {
  if (!await knex.schema.hasColumn(tableName, columnName)) {
    await knex.schema.alterTable(tableName, add);
  }
}

async function hasIndex(knex, tableName, indexName) {
  const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [tableName, indexName]);
  return rows.length > 0;
}

export async function up(knex) {
  await addColumn(knex, 'organizations', 'school_code', (table) =>
    table.string('school_code', 24).nullable());
  await addColumn(knex, 'organizations', 'academic_configuration_json', (table) =>
    table.text('academic_configuration_json').notNullable().defaultTo('{}'));
  await addColumn(knex, 'organizations', 'logo_data', (table) => table.mediumText('logo_data').nullable());
  await addColumn(knex, 'organizations', 'logo_mime_type', (table) =>
    table.string('logo_mime_type', 32).nullable());
  await addColumn(knex, 'organizations', 'logo_size_bytes', (table) =>
    table.integer('logo_size_bytes').unsigned().notNullable().defaultTo(0));
  await knex('organizations')
    .where((query) => query.whereNull('academic_configuration_json')
      .orWhere('academic_configuration_json', ''))
    .update({ academic_configuration_json: '{}' });

  const organizations = await knex('organizations').whereNull('school_code').select('id');
  for (const organization of organizations) {
    let code;
    do {
      code = `SCH-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    } while (await knex('organizations').where({ school_code: code }).first('id'));
    await knex('organizations').where({ id: organization.id }).update({ school_code: code });
  }

  await knex.schema.alterTable('organizations', (table) => {
    table.string('school_code', 24).notNullable().alter();
  });
  if (!await hasIndex(knex, 'organizations', 'organizations_school_code_unique')) {
    await knex.schema.alterTable('organizations', (table) =>
      table.unique(['school_code'], 'organizations_school_code_unique'));
  }

  await addColumn(knex, 'subscription_plans', 'billing_cycle', (table) =>
    table.string('billing_cycle', 16).notNullable().defaultTo('monthly'));
  await addColumn(knex, 'subscription_plans', 'max_users', (table) =>
    table.integer('max_users').unsigned().nullable());
  await addColumn(knex, 'subscription_plans', 'storage_limit_bytes', (table) =>
    table.bigInteger('storage_limit_bytes').unsigned().nullable());

  if (!await knex.schema.hasTable('subscription_refunds')) {
    await knex.schema.createTable('subscription_refunds', (table) => {
      table.string('id', 36).primary();
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('RESTRICT');
      table.string('payment_id', 36).notNullable()
        .references('id').inTable('subscription_payments').onDelete('RESTRICT');
      table.decimal('amount', 12, 2).unsigned().notNullable();
      table.string('reason', 500).notNullable();
      table.string('recorded_by', 36).notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      table.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now());
      table.index(['organization_id', 'recorded_at'], 'sub_refund_org_date_idx');
      table.index(['payment_id'], 'sub_refund_payment_idx');
    });
  }

  if (!await knex.schema.hasTable('platform_global_settings')) {
    await knex.schema.createTable('platform_global_settings', (table) => {
      table.string('id', 16).primary();
      table.string('default_locale', 8).notNullable().defaultTo('en');
      table.string('currency_code', 3).notNullable().defaultTo('ETB');
      table.string('date_format', 32).notNullable().defaultTo('dd/MM/yyyy');
      table.string('calendar_type', 16).notNullable().defaultTo('ethiopian');
      table.string('smtp_host', 255).notNullable().defaultTo('');
      table.integer('smtp_port').unsigned().notNullable().defaultTo(587);
      table.boolean('smtp_secure').notNullable().defaultTo(false);
      table.string('smtp_user', 254).notNullable().defaultTo('');
      table.text('smtp_password_ciphertext').nullable();
      table.string('smtp_from', 254).notNullable().defaultTo('noreply@smartschool.local');
      table.timestamps(true, true);
    });
  }
  await knex('platform_global_settings').insert({
    id: 'global', default_locale: 'en', currency_code: 'ETB',
    date_format: 'dd/MM/yyyy', calendar_type: 'ethiopian', smtp_host: '',
    smtp_port: 587, smtp_secure: false, smtp_user: '',
    smtp_from: 'noreply@smartschool.local'
  }).onConflict('id').ignore();

  const starter = await knex('subscription_plans').where({ code: 'starter' })
    .first('id', 'max_users', 'storage_limit_bytes');
  if (starter) {
    const defaults = {};
    if (starter.max_users == null) defaults.max_users = 50;
    if (starter.storage_limit_bytes == null) defaults.storage_limit_bytes = 1073741824;
    if (Object.keys(defaults).length) {
      await knex('subscription_plans').where({ id: starter.id }).update(defaults);
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('platform_global_settings');
  await knex.schema.dropTableIfExists('subscription_refunds');
  if (await knex.schema.hasColumn('subscription_plans', 'storage_limit_bytes')) {
    await knex.schema.alterTable('subscription_plans', (table) =>
      table.dropColumn('storage_limit_bytes'));
  }
  if (await knex.schema.hasColumn('subscription_plans', 'max_users')) {
    await knex.schema.alterTable('subscription_plans', (table) => table.dropColumn('max_users'));
  }
  if (await knex.schema.hasColumn('subscription_plans', 'billing_cycle')) {
    await knex.schema.alterTable('subscription_plans', (table) => table.dropColumn('billing_cycle'));
  }
  if (await knex.schema.hasColumn('organizations', 'academic_configuration_json')) {
    await knex.schema.alterTable('organizations', (table) =>
      table.dropColumn('academic_configuration_json'));
  }
  for (const column of ['logo_data', 'logo_mime_type', 'logo_size_bytes']) {
    if (await knex.schema.hasColumn('organizations', column)) {
      await knex.schema.alterTable('organizations', (table) => table.dropColumn(column));
    }
  }
  if (await hasIndex(knex, 'organizations', 'organizations_school_code_unique')) {
    await knex.schema.alterTable('organizations', (table) =>
      table.dropUnique(['school_code'], 'organizations_school_code_unique'));
  }
  if (await knex.schema.hasColumn('organizations', 'school_code')) {
    await knex.schema.alterTable('organizations', (table) => {
      table.dropColumn('school_code');
    });
  }
}
