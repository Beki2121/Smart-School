export async function up(knex) {
  await knex('subscription_plans').where({ code: 'starter', max_users: 50 })
    .update({ max_users: null });
  await knex('subscription_plans').where({
    code: 'starter', storage_limit_bytes: 1073741824
  }).update({ storage_limit_bytes: null });
}

export async function down() {}
