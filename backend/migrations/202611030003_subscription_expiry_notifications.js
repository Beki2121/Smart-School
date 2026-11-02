export async function up(knex) {
  if (await knex.schema.hasTable('user_notifications')) {
    if (!await knex.schema.hasColumn('user_notifications', 'organization_id')) {
      await knex.schema.alterTable('user_notifications', (table) => {
        table.string('organization_id', 36).nullable()
          .references('id').inTable('organizations').onDelete('CASCADE');
      });
    }
    if (await knex.schema.hasColumn('user_notifications', 'campus_id')) {
      await knex.schema.alterTable('user_notifications', (table) => {
        table.string('campus_id', 36).nullable().alter();
      });
    }
  }

  if (!await knex.schema.hasTable('subscription_expiry_notices')) {
    await knex.schema.createTable('subscription_expiry_notices', (table) => {
      table.string('id', 36).primary();
      table.string('subscription_id', 36).notNullable()
        .references('id').inTable('organization_subscriptions').onDelete('CASCADE');
      table.string('organization_id', 36).notNullable()
        .references('id').inTable('organizations').onDelete('CASCADE');
      table.timestamp('expiry_at').notNullable();
      table.integer('threshold_days').unsigned().notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.unique(
        ['subscription_id', 'expiry_at', 'threshold_days'],
        'subscription_expiry_notice_period_uq'
      );
      table.index(['organization_id', 'created_at'], 'subscription_expiry_notice_org_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('subscription_expiry_notices');
  if (await knex.schema.hasColumn('user_notifications', 'organization_id')) {
    await knex('user_notifications').whereNull('campus_id').del();
    await knex.schema.alterTable('user_notifications', (table) =>
      table.dropColumn('organization_id'));
  }
  if (await knex.schema.hasColumn('user_notifications', 'campus_id')) {
    await knex.schema.alterTable('user_notifications', (table) => {
      table.string('campus_id', 36).notNullable().alter();
    });
  }
}
