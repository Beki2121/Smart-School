export async function up(knex) {
  if (await knex.schema.hasTable('assignments') &&
      await knex.schema.hasColumn('assignments', 'due_at')) {
    await knex.raw(
      'ALTER TABLE ?? MODIFY ?? TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
      ['assignments', 'due_at']
    );
  }
}

export async function down() {
  throw new Error('WP7 assignment timestamp repair is forward-only.');
}
