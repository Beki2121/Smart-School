export async function up(knex) {
  if (await knex.schema.hasTable('term_report_revisions') &&
      !await knex.schema.hasColumn('term_report_revisions', 'amendment_reason')) {
    await knex.schema.alterTable('term_report_revisions', (table) => {
      table.string('amendment_reason', 500).nullable();
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('term_report_revisions', 'amendment_reason')) {
    await knex.schema.alterTable('term_report_revisions', (table) => {
      table.dropColumn('amendment_reason');
    });
  }
}
