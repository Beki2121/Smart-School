export async function up(knex) {
  if (!await knex.schema.hasTable('marks')) return;
  if (!await knex.schema.hasColumn('marks', 'approved_by')) {
    await knex.schema.alterTable('marks', (table) => {
      table.string('approved_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    });
  }
  if (!await knex.schema.hasColumn('marks', 'published_by')) {
    await knex.schema.alterTable('marks', (table) => {
      table.string('published_by', 36).nullable().references('id').inTable('users').onDelete('RESTRICT');
    });
  }
  if (await knex.schema.hasTable('audit_log')) {
    await knex.raw(`
      UPDATE marks AS m
      JOIN (
        SELECT a.entity_id, MIN(a.actor_id) AS actor_id
        FROM audit_log AS a
        JOIN users AS u ON u.id = a.actor_id
        WHERE a.entity_type = 'mark' AND a.action = 'mark.approved'
        GROUP BY a.entity_id
      ) AS approval ON approval.entity_id = m.id
      SET m.approved_by = approval.actor_id
      WHERE m.approved_by IS NULL
    `);
    await knex.raw(`
      UPDATE marks AS m
      JOIN (
        SELECT a.entity_id, MIN(a.actor_id) AS actor_id
        FROM audit_log AS a
        JOIN users AS u ON u.id = a.actor_id
        WHERE a.entity_type = 'mark' AND a.action = 'mark.locked'
        GROUP BY a.entity_id
      ) AS publication ON publication.entity_id = m.id
      SET m.published_by = publication.actor_id
      WHERE m.published_by IS NULL
    `);
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('marks', 'published_by')) {
    await knex.schema.alterTable('marks', (table) => {
      table.dropForeign(['published_by']);
      table.dropColumn('published_by');
    });
  }
  if (await knex.schema.hasColumn('marks', 'approved_by')) {
    await knex.schema.alterTable('marks', (table) => {
      table.dropForeign(['approved_by']);
      table.dropColumn('approved_by');
    });
  }
}
