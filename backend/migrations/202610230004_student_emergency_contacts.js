export async function up(knex) {
  if (!await knex.schema.hasTable('student_emergency_contacts')) {
    await knex.schema.createTable('student_emergency_contacts', (table) => {
      table.string('id', 36).primary();
      table.string('campus_id', 36).notNullable().references('id').inTable('campuses').onDelete('RESTRICT');
      table.string('student_id', 36).notNullable().references('id').inTable('students').onDelete('RESTRICT');
      table.text('contact_name_enc').notNullable();
      table.text('phone_enc').notNullable();
      table.string('relationship', 60).notNullable();
      table.integer('priority').unsigned().notNullable().defaultTo(1);
      table.string('created_by', 36).notNullable().references('id').inTable('users').onDelete('RESTRICT');
      table.timestamps(true, true);
      table.index(['campus_id', 'student_id', 'priority'], 'student_emergency_contact_priority_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('student_emergency_contacts');
}
